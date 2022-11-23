// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This is an extension of schema.js where we define *entity-specific* functions
// for dealing with the XForms XML schema and transforming submission XML into
// entities.

const csv = require('csv-stringify');
const { Transform } = require('stream');
const { PartialPipe } = require('../util/stream');
const Problem = require('../util/problem');
const { submissionXmlToFieldStream } = require('./submission');

////////////////////////////////////////////////////////////////////////////
// ENTITY PARSING

// After collecting the entity data from the submission and form fields,
// we validate the data (properties must include dataset, label, and uuid)
// and assemble a valid entity data object. System properties like dataset
// label, uuid are in entity.system while the contents from the bound form
// fields are in enttiy.data.
const validateEntity = (entity) => {
  const { dataset, label, id } = entity.system;

  if (!dataset || dataset.trim() === '')
    throw Problem.user.entityViolation({ reason: 'Dataset empty or missing.' });

  if (!label || label.trim() === '')
    throw Problem.user.entityViolation({ reason: 'Label empty or missing.' });

  if (!id || id.trim() === '')
    throw Problem.user.entityViolation({ reason: 'ID empty or missing.' });

  const uuidPattern = /^(uuid:)?([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
  const matches = uuidPattern.exec(id);
  if (matches == null) throw Problem.user.entityViolation({ reason: `ID [${id}] is not a valid UUID.` });
  const uuid = matches[2].toLowerCase();

  // If create is not an allowed value of true, don't return entity data
  if (!(entity.system.create === '1' || entity.system.create === 'true'))
    return null;

  const newEntity = { ...entity };
  newEntity.system.uuid = uuid;
  delete newEntity.system.id;
  delete newEntity.system.create;
  return newEntity;
};

// This works similarly to processing submissions for export, but also note:
// 1. this is expecting the entityFields to be filled in with propertyName attributes
// 2. the "meta/entity" structural field should be included to get necessary
//    entity node attributes like dataset name.
const parseSubmissionXml = (entityFields, xml) => new Promise((resolve, reject) => {
  const entity = { system: Object.create(null), data: Object.create(null) };
  const stream = submissionXmlToFieldStream(entityFields, xml, true);
  stream.on('error', reject);
  stream.on('data', ({ field, text }) => {
    if (field.name === 'entity') {
      entity.system.dataset = field.attrs.dataset;
      entity.system.id = field.attrs.id;
      entity.system.create = field.attrs.create;
    } else if (field.path.indexOf('/meta/entity') === 0)
      entity.system[field.name] = text;
    else if (field.propertyName != null)
      entity.data[field.propertyName] = text;
  });
  stream.on('end', () => {
    try {
      resolve(validateEntity(entity));
    } catch (err) {
      reject(err);
    }
  });
});


////////////////////////////////////////////////////////////////////////////
// ENTITY STREAMING

const formatRow = (entity, props) => {
  const out = [];
  out.push(entity.uuid);
  out.push(entity.label);
  for (const prop of props) out.push(entity.def.data[prop]);
  return out;
};

const streamEntityCsvs = (inStream, properties) => {
  const header = [ 'name', 'label' ];
  const props = [];

  for (let idx = 0; idx < properties.length; idx += 1) {
    const field = properties[idx];
    const prop = field.name;
    header.push(prop);
    props.push(prop);
  }

  let rootHeaderSent = false;
  const rootStream = new Transform({
    objectMode: true,
    transform(entity, _, done) {
      try {
        if (rootHeaderSent === false) {
          this.push(header);
          rootHeaderSent = true;
        }
        this.push(formatRow(entity, props));
        done();
      } catch (ex) { done(ex); }
    }, flush(done) {
      if (rootHeaderSent === false) this.push(header);
      done();
    }
  });

  return PartialPipe.of(inStream, rootStream, csv());
};


module.exports = { parseSubmissionXml, validateEntity, streamEntityCsvs };
