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
  const match = /^$|^__|[.,:]/g.exec(name.trim());
  return (match == null);
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
    metaNode(findOne(root(), node('entity'))(tree())),
    metaNode(findOne(root(), and(node('entity'), hasAttr('dataset')))(attr('dataset')))
  ]).then(([ entityTag, datasetName ]) => {
    // check if <entity> tag exists at all
    if (entityTag.isEmpty() && datasetName.isEmpty())
      return Option.none();
    // check that dataset name is valid
    if (datasetName.isEmpty())
      throw Problem.user.invalidEntityForm({ reason: 'Dataset name is empty.' });
    if (!validateDatasetName(datasetName.get()))
      throw Problem.user.invalidEntityForm({ reason: 'Invalid dataset name.' });
    return Option.of(datasetName.get().toLowerCase());
  });
};

module.exports = { getDataset, validateDatasetName };
