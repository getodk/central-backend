// Copyright 2017 Jubilant Garbanzo Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/nafundi/jubilant-garbanzo/blob/master/NOTICE.
// This file is part of Jubilant Garbanzo. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of Jubilant Garbanzo,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Forms are at the heart of ODK; they define the questions to be asked, the data
// to be stored, and any logic connecting it all together. The biggest bit of work
// this Instance class does is to parse a given XForms XML string and if it is valid
// to pull out values we will need later, like its formId and MD5 hash.
//
// It also provides convenience entrypoints to the schema information returned by
// lib/data/schema.js.

const { reduce, merge, pick } = require('ramda');
const { validate } = require('fast-xml-parser');
const { createHash } = require('crypto');
const { toTraversable, findAndTraverse, traverseFirstChild } = require('../../util/xml');
const Instance = require('./instance');
const ActeeTrait = require('../trait/actee');
const Problem = require('../../util/problem');
const { isBlank } = require('../../util/util');
const { withCreateTime, withUpdateTime } = require('../../util/instance');
const Option = require('../../util/option');
const { resolve, reject } = require('../../util/promise');
const { getFormSchema, getSchemaTables } = require('../../data/schema');

const formFields = [ 'id', 'xmlFormId', 'xml', 'version', 'state', 'hash', 'name', 'acteeId', 'createdAt', 'updatedAt', 'deletedAt' ];
Object.freeze(formFields);

const states = { draft: 'draft', open: 'open', closing: 'closing', closed: 'closed' };
Object.freeze(states);

module.exports = Instance.with(ActeeTrait)(({ simply, Form, forms }) => class {
  forCreate() { return withCreateTime(this); }
  create() { return forms.create(this); }

  forUpdate() { return withUpdateTime(this.pick('name', 'state')); }
  update() { return simply.update('forms', this); }

  delete() { return simply.markDeleted('forms', this); }

  forApi() {
    // TODO: generally better handling of extended metadata output.
    const additional = (this.createdBy != null)
      ? { createdBy: this.createdBy.map((actor) => actor.forApi()).orNull() }
      : {};
    return merge(this.without('id', 'acteeId', 'deletedAt'), additional);
  }

  // These two methods call into lib/data/schema.js to provide schema information.
  schema() { return getFormSchema(this); }
  tables() { return getSchemaTables(this.schema()); }

  acceptsSubmissions() { return (this.state === 'open') || (this.state === 'closing'); }

  static fromApi(data) {
    if (Object.hasOwnProperty.call(data, 'state') && (states[data.state] == null))
      throw Problem.user.unexpectedValue({ field: 'state', value: data.state, reason: 'not a recognized state name' });
    return new Form(pick(Form.fields(), data));
  }

  // Given an XML string, returns Promise[Form]. If the Promise rejects, the XML
  // is not valid. If it resolves, fields like xmlFormId, version, name, and hash will
  // be populated on the resulting Form Instance, along with the XML itself.
  // TODO: should it return Promise[Option[Form]] instead?
  static fromXml(xml) {
    if (!validate(xml))
      return reject(Problem.user.unparseable({ format: 'xml', rawLength: xml.length }));
    const traversable = toTraversable(xml);

    // find the data node nested inside instance (which has no definite name).
    const instanceNodePath = [ 'html', 'head', 'model', 'instance' ];
    const dataNode =
      Option.of(reduce(findAndTraverse, traversable, instanceNodePath))
        .map(traverseFirstChild);

    // first check for a form id, as we can fail early if we can't find one.
    const xmlFormId =
      dataNode
        .map((data) => findAndTraverse(data, '@_id'))
        .map((idNode) => idNode.val);
    if (!xmlFormId.isDefined() || isBlank(xmlFormId.get()))
      return reject(Problem.user.missingParameter({ field: 'formId' }));

    // find and cache version.
    const version =
      dataNode
        .map((data) => findAndTraverse(data, '@_version'))
        .map((versionNode) => versionNode.val)
        .orElse('');

    // find and cache form name.
    const name =
      Option.of(reduce(findAndTraverse, traversable, [ 'html', 'head', 'title' ]))
        .map((titleNode) => titleNode.val)
        .orNull();

    // hash and cache the xml.
    const hash = createHash('md5').update(xml).digest('hex');
    return resolve(new Form({ xmlFormId: xmlFormId.get(), xml, name, version, hash }));
  }

  static getByXmlFormId(xmlFormId, extended) {
    return forms.getByXmlFormId(xmlFormId, extended);
  }

  static getAll(extended) { return forms.getAll(extended); }
  static getOpen(extended) { return forms.getOpen(extended); }

  species() { return 'form'; }

  static fields() { return formFields; }
  static states() { return states; }
});

