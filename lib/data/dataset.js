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
const { traverseXml, findOne, root, node, attr, stripNamespacesFromPath } = require('../util/xml');

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
getDataset() parses form XML for dataset-related information on the <entity>
tag:

  - The dataset name
  - The entity actions permitted by the form def

getDataset() also does some validation, including of:

  - The version of the entities spec
  - The dataset name

Like with getFormFields() in schema.js, we assume the form is otherwise valid.
*/
const getDataset = (xml) =>
  traverseXml(xml, [
    findOne(root('html'), node('head'), node('model'))(attr('entities-version')),
    findOne(root('html'), node('head'), node('model'), node('instance'), node(), node('meta'), node('entity'))(attr())
  ]).then(([ version, entityAttrs ]) => {
    if (entityAttrs.isEmpty())
      return Option.none();

    // Validate the entity spec version
    const warnings = validateEntitySpecVersion(version);

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

    return Option.of({ name: datasetName, actions, warnings });
  });

module.exports = { getDataset, validateDatasetName, validatePropertyName };
