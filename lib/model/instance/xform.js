// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// XForms are the blob of XML that define what a form is, along with some fields
// that are extracted out of that XML for perf caching.
//
// The biggest bit of work this Instance class does is to parse a given XForms
// XML string and if it is valid to pull out values we will need later, like its
// formId and MD5 hash.
//
// It also provides convenience entrypoints to the schema information returned by
// lib/data/schema.js.
//
// The nice thing about having xml definitions be separate from Forms is that they
// are therefore immutable. Therefore we don't have to worry about any update cases
// at all.

const Instance = require('./instance');
const { getFormSchema, getSchemaTables } = require('../../data/schema');
const { ExtendedInstance, HasExtended } = require('../trait/extended');
const { md5sum, shasum, sha256sum } = require('../../util/crypto');
const Problem = require('../../util/problem');
const { blankStringToNull } = require('../../util/util');
const { traverseXml, findOne, root, node, attr, text } = require('../../util/xml');


// the only thing we push off onto extended is the xml itself.
const ExtendedXForm = ExtendedInstance({
  fields: { readable: [ 'version', 'hash', 'sha', 'sha256' ] }
});

module.exports = Instance.with(HasExtended(ExtendedXForm))('xforms', {
  all: [ 'id', 'xml', 'version', 'hash', 'sha', 'sha256' ],
  readable: [ 'version', 'hash', 'sha', 'sha256' ],
  writable: []
})(({ xforms }) => class {

  // creates if not exists, and returns the id of the ensured record.
  ensure() { return xforms.ensure(this); }

  // These two methods call into lib/data/schema.js to provide schema information.
  schema() { return getFormSchema(this); }
  tables() { return this.schema().then(getSchemaTables); }

  // Given an XML string, returns Promise[Object]. If the Promise rejects, the XML
  // is not valid. If it resolves, fields like xmlFormId, version, name, and hash will
  // be populated on the resulting Form Instance, along with the XML itself.
  //
  // The Object data contains mostly XForm data, but it also contains xmlFormId,
  // which is a Form property and so a plain object is returned.
  static parseXml(xml) {
    const dataNode = findOne(root('html'), node('head'), node('model'), node('instance'), node());
    return traverseXml(xml, [
      dataNode(attr('id')),
      dataNode(attr('version')),
      findOne(root('html'), node('head'), node('title'))(text())
    ]).then(([ idText, versionText, nameText ]) => {
      const xmlFormId = idText.map(blankStringToNull).orElseGet(() => {
        throw Problem.user.missingParameter({ field: 'formId' });
      });
      const version = versionText.orElse('');
      const name = nameText.orNull();

      // hash and cache the xml.
      // TODO: is there a big benefit to parallelizing the hashing via streams?
      return { xmlFormId, xml, name, version, hash: md5sum(xml), sha: shasum(xml), sha256: sha256sum(xml) };
    });
  }
});

