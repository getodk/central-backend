// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { traverseXml, findOne, findAll, and, root, node, hasAttr, attr } = require('../util/xml');
const { submissionXmlToFieldStream } = require('./submission');
const { Form } = require('../model/frames');
const { construct } = require('../util/util');

// turn Option[Array[Option[x]]] into Array[x]; used just below in getFormFields
const getList = (x) => x.map((xs) => xs.map((y) => y.orElse({}))).orElse([]);

const getEntityDef = (xml) => {
  const modelNode = findOne(root('html'), node('head'), node('model'));
  return traverseXml(xml, [
    modelNode(findOne(node('meta'), and(node('entity'), hasAttr('dataset')))(attr('dataset'))),
    modelNode(findAll(root(), and(node('bind'), hasAttr('ref')))(attr()))
  ]).then(([entity, bindings]) => {
    if (entity.isEmpty()) return null;
    const dataset = entity.get();
    const mapping = getList(bindings)
      .filter((bind) => ('entities:ref' in bind))
      .map((bind) => ({
        path: bind.nodeset.replace(/^(\/data)/, ''),
        entity_prop: bind['entities:ref']
      }));
    return { dataset, mapping };
  });
};

const getEntityFromSub = (fields, xml) => new Promise((resolve, reject) => {
  const values = {};
  const allFields = fields.concat([
    { path: '/meta/entity/label', entity_prop: 'label' },
    { path: '/meta/entity/create', entity_prop: 'create' },
    { path: '/meta/entity/id', entity_prop: 'entity_id' }
  ]);
  const stream = submissionXmlToFieldStream(allFields.map(construct(Form.Field)), xml);
  stream.on('error', reject);
  stream.on('data', ({ field, text }) => {
    values[field.entity_prop] = text;
  });
  stream.on('end', () => { resolve(values); });
});

const getEntityUsingFields = (fields, xml) => new Promise((resolve, reject) => {
  const values = {};
  const stream = submissionXmlToFieldStream(fields.map(construct(Form.Field)), xml);
  stream.on('error', reject);
  stream.on('data', ({ field, text }) => {
    if (field.path === '/meta/entity/label')
      values.label = text;
    else if (field.entity_prop != null)
      values[field.entity_prop] = text;
  });
  stream.on('end', () => { resolve(values); });
});

module.exports = {
  getEntityDef,
  getEntityFromSub,
  getEntityUsingFields
};
