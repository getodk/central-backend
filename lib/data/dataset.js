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
// for dealing with the XForms XML schema. When a form is uploaded to Central,
// we check the XML for an <entity> block, which will contain information
// about datasets and mappings from form fields to
// dataset properties.

const semverSatisfies = require('semver/functions/satisfies');

const Option = require('../util/option');
const Problem = require('../util/problem');
const { traverseXml, findOne, findAllWithPath, root, node, attr, stripNamespacesFromPath } = require('../util/xml');


/*
Validates the entities-version spec
https://getodk.github.io/xforms-spec/entities.html

- 2022.1: entity creation
- 2023.1: entity updates
- 2024.1: offline entities
- 2025.1: entities from repeats
*/
const validateEntitySpecVersion = (version) => {
  if (version.isEmpty())
    throw Problem.user.invalidEntityForm({ reason: 'Entities specification version is missing.' });
  else if (!semverSatisfies(version.get(), '2022.1.0 - 2025.1.x'))
    throw Problem.user.invalidEntityForm({ reason: `Entities specification version [${version.get()}] is not supported.` });

  const warnings = semverSatisfies(version.get(), '>=2024.1.x')
    ? null
    : [{
      type: 'oldEntityVersion',
      details: { version: version.get() },
      reason: `Entities specification version [${version.get()}] is not compatible with Offline Entities. Please use version 2024.1.0 or later.`
    }];

  return warnings;
};

const validateEntityRepeatVersion = (version, datasets) => {
  if (datasets.length > 1 && semverSatisfies(version.get(), '<2025.1.x'))
    throw Problem.user.invalidEntityForm({ reason: `Entities specification version [${version.get()}] is not compatible with multiple entity lists.  Please use version 2025.1.0 or later.` });
};

/*
Validates a dataset name:

  - valid xml identifier
  - does not contain `.`
  - `__` prefix reserved
  - case insensitive?
*/
const validateDatasetName = (name) => {
  // Regex explanation:
  // Check for a match with a valid string
  //   (?!__) is negative lookahead to check string does not start with double underscore __
  //   [\p{L}:_] valid start character of unicode letter or : or _
  //   [\p{L}:\d_-]* more characters from valid starting character set and digits and hyphens
  // If there's a match, return true (valid)!
  // Note that '.' is not in the valid character set.
  // Non-letter unicode characters also not currently allowed
  const match = /^(?!__)[\p{L}:_][\p{L}:\d_-]*$/u.exec(name);
  return (match !== null);
};

const validatePropertyName = (name) => {
  // Regex explanation
  // (similar to above dataset name check with some slight differences)
  // Check for a match with a valid string
  //   (?!__) is negative lookahead to check string does not start with double underscore __
  //   (?!name$)(?!label$) negative lookahead for "name" and "label" specifically, insensitive to case
  //   [\p{L}_] valid start character of unicode letter or _ (no :)
  //   [\p{L}\d\\._-]* more characters from valid starting character set, digits, hyphens, and '.'
  // If there's a match, return true (valid)!
  // Non-letter unicode characters also not currently allowed
  const match = /^(?!__)(?!name$)(?!label$)[\p{L}_][\p{L}\d._-]*$/u.exec(name.toLowerCase());

  return (match !== null);
};

/*
Extracts the dataset name and actions from an <entity> block.
*/
const getNameAndActions = (entityAttrs) => {
  const strippedAttrs = Object.create(null);
  for (const [name, value] of Object.entries(entityAttrs.get()))
    strippedAttrs[stripNamespacesFromPath(name)] = value;

  // check that dataset name is valid
  const datasetName = strippedAttrs.dataset?.trim();
  if (datasetName == null)
    throw Problem.user.invalidEntityForm({ reason: 'Dataset name is missing.' });
  if (!validateDatasetName(datasetName))
    throw Problem.user.invalidEntityForm({ reason: 'Invalid dataset name.' });

  // Entity actions permitted by the form def
  const actions = [];
  const { create, update } = strippedAttrs;
  if (create != null) actions.push('create');
  if (update != null) actions.push('update');
  if (actions.length === 0)
    throw Problem.user.invalidEntityForm({ reason: 'The form must specify at least one entity action, for example, create or update.' });

  return { name: datasetName, actions };
};

/*
getDatasets() parses form XML for dataset-related information on the <entity>
tag and returns a list of datasets, each one including:

  - The dataset name
  - The entity actions permitted by the form def

getDatasets() also does some validation, including of:

  - The version of the entities spec
  - The dataset name

Like with getFormFields() in schema.js, we assume the form is otherwise valid.
*/
const getDatasets = async (xml) => {
  const instanceNode = findOne(root('html'), node('head'), node('model'), node('instance'), node());
  const [version, entityBlocks] = await traverseXml(xml, [
    findOne(root('html'), node('head'), node('model'))(attr('entities-version')),
    instanceNode(findAllWithPath(node('meta'), node('entity'))(attr()))
  ]);

  // Don't check anything if no entity block exists
  if (entityBlocks.get().length === 0)
    return Option.none();

  // Validate the entity spec version
  const warnings = validateEntitySpecVersion(version);

  // Find all datasets in the XML
  const datasets = [];
  for (const e of entityBlocks.get()) {
    const { name, actions } = getNameAndActions(e.data);
    // Remove the 'data' at the beginning and /meta/entity at the end
    const path = e.path.replace(/^data|meta\/entity\/$/g, '');
    datasets.push({ name, actions, path });
  }

  // Throw error if <v2025.1 and there are multiple datasets
  validateEntityRepeatVersion(version, datasets);

  return Option.of({ datasets, warnings });
};


// Take parsed datasets and parsed form fields and match up fields
// with their correct dataset based on path
const matchFieldsWithDatasets = (datasets, fields) => {
  // Validate user-provided property names before processing
  if (fields.some((field) => field.propertyName && !validatePropertyName(field.propertyName)))
    throw Problem.user.invalidEntityForm({ reason: 'Invalid entity property name.' });

  const resultMap = new Map(datasets.map(dataset => [dataset.path, { dataset, fields: [] }]));

  // Sort dataset paths by length descending for specificity
  const sortedPaths = [...datasets.map(ds => ds.path)].sort(
    (a, b) => b.split('/').length - a.split('/').length
  );

  for (const field of fields) {
    const exactMatch = sortedPaths.find(dsPath => field.path + '/' === dsPath);
    if (exactMatch != null) {
      if (field.type === 'repeat')
        resultMap.get(exactMatch).dataset.isRepeat = true;
    } else {
      // Find the most specific dataset path that is a prefix of the field path
      const matchedPath = sortedPaths.find(dsPath => (field.path + '/').startsWith(dsPath));

      if (matchedPath != null && field.propertyName) {
        resultMap.get(matchedPath).fields.push(field);
      }
    }
  }

  return Array.from(resultMap.values());
};

module.exports = { getDatasets, matchFieldsWithDatasets, validateDatasetName, validatePropertyName };
