// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This is an extension of schema.js where we define *datasest-specific* functions
// for dealing with the XForms XML schema. When a form us uploaded to Central,
// we check the XML for an <entity> block, which will contain information
// about datasets and mappings from form fields to
// dataset properties.

const Option = require('../util/option');
const Problem = require('../util/problem');
const { traverseXml, findOne, and, root, node, hasAttr, tree, attr } = require('../util/xml');

const validateDatasetName = (name) => {
  // Regex explanation:
  // Check for a match with a valid string
  //   (?!__) is negative lookahead to check string does not start with double underscore __
  //   [\p{L}:_] valid start character of unicode letter or : or _
  //   [\p{L}:\d_-]* more characters from valid starting character set and digits and hyphens
  // If there's a match, return true (valid)!
  // Note that '.' is not in the valid character set.
  // Non-letter unicode characters also not currently allowed
  const match = /^(?!__)[\p{L}:_][\p{L}:\d_-]*$/u.exec(name.trim());
  return (match !== null);
};

// Here we are looking for dataset-registrating information within the <entity> tag.
// We mainly need the dataset name, but we also do a bit of validation:
//   1. namespace validation:
//       e.g. xmlns:entities="http://www.opendatakit.org/xforms/entities
//   2. dataset name validation:
//       - valid xml identifier
//       - does not contain `.`
//       - `__` prefix reserved
//       - case insensitive?
//
// Like with getFormFields in schema.js, we assume the form is otherwise valid.
const getDataset = (xml) => {
  const metaNode = findOne(root('html'), node('head'), node('model'), node('instance'), node(), node('meta'));
  return traverseXml(xml, [
    findOne(root('html'), node('head'), node('model'))(attr('entities-version')),
    metaNode(findOne(root(), node('entity'))(tree())),
    metaNode(findOne(root(), and(node('entity'), hasAttr('dataset')))(attr('dataset')))
  ]).then(([ version, entityTag, datasetName ]) => {
    if (entityTag.isEmpty() && datasetName.isEmpty())
      return Option.none();
    if (version.isEmpty())
      throw Problem.user.invalidEntityForm({ reason: 'Entities specification version is missing.' });
    else if (!version.get().startsWith('2022.1.'))
      throw Problem.user.invalidEntityForm({ reason: `Entities specification version [${version.get()}] is not supported.` });
    // check that dataset name is valid
    if (datasetName.isEmpty())
      throw Problem.user.invalidEntityForm({ reason: 'Dataset name is missing.' });
    if (!validateDatasetName(datasetName.get()))
      throw Problem.user.invalidEntityForm({ reason: 'Invalid dataset name.' });
    return Option.of(datasetName.get().trim());
  });
};

module.exports = { getDataset, validateDatasetName };
