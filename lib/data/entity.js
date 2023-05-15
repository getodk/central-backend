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
const { clone, path } = require('ramda');
const { Transform } = require('stream');
const { PartialPipe } = require('../util/stream');
const Problem = require('../util/problem');
const { submissionXmlToFieldStream } = require('./submission');
const { nextUrlFor, getServiceRoot, jsonDataFooter, extractPaging } = require('../util/odata');
const { sanitizeOdataIdentifier } = require('../util/util');

const odataToColumnMap = new Map([
  ['__system/createdAt', 'entities.createdAt'],
  ['__system/updatedAt', 'entities.updatedAt'],
  ['__system/creatorId', 'entities.creatorId']
]);

////////////////////////////////////////////////////////////////////////////
// ENTITY PARSING

// After collecting the entity data from the submission and form fields,
// we validate the data (properties must include dataset, label, and uuid)
// and assemble a valid entity data object. System properties like dataset
// label, uuid are in entity.system while the contents from the bound form
// fields are in enttiy.data.
//
// Since validateEntity is also used on entities parsed from JSON, which
// don't include dataset or create flag (these are implicit) we have made
// these specific validation checks optional (but turned on by default).
const validateEntity = (entity, checkDataset = true, checkCreate = true) => {
  const { dataset, label, id } = entity.system;

  if (checkDataset && (!dataset || dataset.trim() === ''))
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
  if (checkCreate && !(entity.system.create === '1' || entity.system.create === 'true'))
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

// Can be used to parse new entities and entity updates from
// request data in the form of JSON.
const extractEntity = (body, propertyNames, existingEntity) => {
  const bodyKeys = ['label', 'uuid', 'data'];
  if (Object.keys(body).filter(k => !bodyKeys.includes(k)).length > 0)
    throw Problem.user.invalidEntity({ reason: 'Unrecognized fields included in request.' });

  let entity;
  if (existingEntity) {
    entity = clone(existingEntity);
    entity.system.id = entity.system.uuid;
    delete entity.system.uuid;
  } else {
    entity = { system: Object.create(null), data: Object.create(null) };
    if (body.uuid && typeof body.uuid !== 'string')
      throw Problem.user.invalidEntity({ reason: 'Value for [uuid] is not a string.' });
    entity.system.id = body.uuid;
  }

  if (body.label != null)
    if (typeof body.label !== 'string')
      throw Problem.user.invalidEntity({ reason: 'Value for [label] is not a string.' });
    else
      entity.system.label = body.label;

  if (body.data == null && body.label == null)
    throw Problem.user.invalidEntity({ reason: 'No entity data or label provided.' });

  if (body.data != null)
    for (const [k, v] of Object.entries(body.data)) {
      if (typeof v !== 'string')
        throw Problem.user.invalidEntity({ reason: `Property value for [${k}] is not a string.` });
      else if (propertyNames.includes(k))
        entity.data[k] = v;
      else
        throw Problem.user.invalidEntity({ reason: `You specified the dataset property [${k}] which does not exist.` });
    }

  return validateEntity(entity, false, false);
};

////////////////////////////////////////////////////////////////////////////
// ENTITY STREAMING

const _formatRow = (entity, props) => {
  const out = [];
  for (const p of props) out.push(path(p.split('.'), entity));
  return out;
};


const _entityTransformer = (header, props) => {
  let headerSent = false;
  const entityStream = new Transform({
    objectMode: true,
    transform(entity, _, done) {
      try {
        if (headerSent === false) {
          this.push(header);
          headerSent = true;
        }
        this.push(_formatRow(entity, props));
        done();
      } catch (ex) { done(ex); }
    }, flush(done) {
      if (headerSent === false) this.push(header);
      done();
    }
  });
  return entityStream;
};

const streamEntityCsv = (inStream, properties) => {
  // Identifiers
  const header = [ '__id', 'label' ];
  const props = ['uuid', 'def.label'];

  // User defined dataset properties
  header.push(...properties.map(p => p.name));
  props.push(...properties.map(p => `def.data.${p.name}`));

  // System properties
  header.push(...[ '__createdAt', '__creatorId', '__creatorName', '__updates', '__updatedAt']);
  props.push(...['createdAt', 'creatorId', 'aux.creator.displayName', 'aux.stats.updates', 'updatedAt']);

  const entityStream = _entityTransformer(header, props);

  const csvStringifyer = csv({
    cast: {
      date: (value) => value.toISOString()
    }
  });

  return PartialPipe.of(inStream, entityStream, csvStringifyer);
};

const streamEntityCsvAttachment = (inStream, properties) => {
  // Identifiers
  const header = [ 'name', 'label' ];
  const props = ['uuid', 'def.label'];

  // User defined dataset properties
  header.push(...properties.map(p => p.name));
  props.push(...properties.map(p => `def.data.${p.name}`));

  const entityStream = _entityTransformer(header, props);

  return PartialPipe.of(inStream, entityStream, csv());
};

const selectFields = (entity, properties, selectedProperties) => {
  const result = {};

  // Handle ID properties
  if (!selectedProperties || selectedProperties.has('__id')) {
    result.__id = entity.uuid;
  }

  if (!selectedProperties || selectedProperties.has('name')) {
    result.name = entity.uuid;
  }

  if (!selectedProperties || selectedProperties.has('label')) {
    result.label = entity.def.label;
  }

  // Handle System properties
  const systemProperties = {
    createdAt: entity.createdAt,
    creatorId: entity.aux.creator.id.toString(),
    creatorName: entity.aux.creator.displayName,
    updates: entity.aux.stats.updates,
    updatedAt: entity.updatedAt
  };

  if (!selectedProperties || selectedProperties.has('__system')) {
    result.__system = systemProperties;
  } else {
    const selectedSysProp = {};
    for (const p of selectedProperties) {
      if (p.startsWith('__system')) {
        const sysProp = p.replace('__system/', '');
        selectedSysProp[sysProp] = systemProperties[sysProp];
      }
    }

    if (Object.keys(selectedSysProp).length > 0) {
      result.__system = selectedSysProp;
    }
  }

  // Handle user defined properties
  properties.forEach(p => {
    if (!selectedProperties || selectedProperties.has(p.name)) {
      result[sanitizeOdataIdentifier(p.name)] = entity.def.data[p.name] ?? '';
    }
  });

  return result;
};

// Validates the '$select'ed properties
// Returns a set of properties or null if $select is null or *
// Note: this function doesn't expand __system properties
const extractSelectedProperties = (query, properties) => {
  if (query.$select && query.$select !== '*') {
    const selectedProperties = query.$select.split(',').map(p => p.trim());
    const propertiesSet = new Set(properties.map(p => p.name));
    selectedProperties.forEach(p => {
      if (p !== '__id' && p !== '__system' && !odataToColumnMap.has(p) && !propertiesSet.has(p)) {
        throw Problem.user.propertyNotFound({ property: p });
      }
    });
    return new Set(selectedProperties);
  }

  return null;
};

// Pagination is done at the database level
const streamEntityOdata = (inStream, properties, domain, originalUrl, query, tableCount) => {
  const serviceRoot = getServiceRoot(originalUrl);
  const { limit, offset, shouldCount } = extractPaging(query);
  const selectedProperties = extractSelectedProperties(query, properties);

  let isFirstEntity = true;
  const rootStream = new Transform({
    writableObjectMode: true, // we take a stream of objects from the db, but
    readableObjectMode: false, // we put out a stream of text.
    transform(entity, _, done) {
      try {
        if (isFirstEntity) { // header or fencepost.
          this.push('{"value":[');
          isFirstEntity = false;
        } else {
          this.push(',');
        }

        this.push(JSON.stringify(selectFields(entity, properties, selectedProperties)));

        done();
      } catch (ex) {
        done(ex);
      }
    }, flush(done) {
      this.push((isFirstEntity) ? '{"value":[],' : '],'); // open object or close row array.

      // @odata.count and nextUrl.
      const nextUrl = nextUrlFor(limit, offset, tableCount, originalUrl);

      this.push(jsonDataFooter({ table: 'Entities', domain, serviceRoot, nextUrl, count: (shouldCount ? tableCount.toString() : null) }));
      done();
    }
  });

  return PartialPipe.of(inStream, rootStream);
};

// Assumption: keys are additive only
// Argument: Array of data object from Entity.Def
const diffEntityData = (defData) => {
  const diffs = [];

  for (let i = 1; i < defData.length; i+=1) {
    const curr = defData[i];
    const prev = defData[i - 1];
    const diff = [];

    for (const key in curr) {
      if (curr[key] !== prev[key]) {
        diff.push({ old: prev[key], new: curr[key], propertyName: key });
      }
    }

    diffs.push(diff);
  }

  return diffs;
};

module.exports = {
  parseSubmissionXml, validateEntity,
  extractEntity,
  streamEntityCsv, streamEntityCsvAttachment,
  streamEntityOdata, odataToColumnMap,
  extractSelectedProperties, selectFields,
  diffEntityData
};
