// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { identity } = require('ramda');
const { Frame, table, readable, species } = require('../frame');

/*
High-level summary:

- Every config is associated with a key, which identifies the config.
- Different configs are set up in different ways. This setup is specified via a
  frame subclass that extends the base Config frame.
- Config type
  - Some configs store JSON values, while others store blobs. This varies by
    key.
  - For configs that store JSON values, how they do so also varies by key.
- API access
  - Some configs can be directly set over the API, while others cannot.
    - Currently all configs can be set over the API, but that wasn't the case in
      the past.
  - All configs can be read over the API. Some require authentication, while
    others are public.
    - We don't try to prevent read access to configs that cannot be set over the
      API. We log configs in the audit log, which can be read over the API, so
      configs are already accessible that way.
  - For configs that store JSON values, the value stored in the database may
    differ from the value returned over the API and logged in the audit log.
    This varies by key.
*/

// `frames` holds the frame subclass for each key.
const frames = new Map();

class Config extends Frame.define(
  table('configs'),
  'key', readable,
  'value',
  'blobId',
  'setAt', readable,
  species('config')
) {
  static forKey(key) { return frames.get(key) ?? this; }
}

Config.isPublic = false;
// eslint-disable-next-line no-param-reassign
const markPublic = (frame) => { frame.isPublic = true; };


////////////////////////////////////////////////////////////////////////////////
// CONFIGS THAT STORE JSON VALUES

/*
defineJsonConfig() is for configs that store JSON values. It defines a frame for
the specified config key, extending Config.

  - key. The config key.
  - valueForApi. A function that transforms the JSON value of the config before
    returning it over the API. The frame will override forApi() and use this
    function. forApi() is also used when logging a config.set audit action.
  - fromValue (optional). A function that transforms a request body to a JSON
    value for the config. If this function is not specified, the config cannot
    be directly set over the API.
*/
const defineJsonConfig = (key, valueForApi, fromValue = undefined) => {
  const ConfigForKey = class extends Config {
    forApi() { return { ...super.forApi(), value: valueForApi(this.value) }; }
  };
  if (fromValue != null)
    ConfigForKey.fromValue = (value) => new ConfigForKey({ key, value: fromValue(value) });
  frames.set(key, ConfigForKey);
  return ConfigForKey;
};

defineJsonConfig('analytics', identity, (value) => {
  const result = {
    enabled: value != null && typeof value === 'object' && value.enabled === true
  };
  if (result.enabled) {
    if ((typeof value.email === 'string') && (value.email !== ''))
      result.email = value.email;
    if ((typeof value.organization === 'string') && (value.organization !== ''))
      result.organization = value.organization;
  }
  return result;
});

markPublic(defineJsonConfig('login-appearance', identity, (value) => {
  const result = {};
  if (value != null && typeof value === 'object') {
    const { title, description } = value;
    if (typeof title === 'string' && title !== '')
      result.title = title;
    if (typeof description === 'string' && description !== '')
      result.description = description;
  }
  return result;
}));


////////////////////////////////////////////////////////////////////////////////
// CONFIGS THAT STORE BLOBS

Config.Blob = class extends Config {
  forApi() { return { ...super.forApi(), blobExists: this.blobId != null }; }
};

const defineBlobConfig = (key) => {
  const ConfigForKey = class extends Config.Blob {};
  ConfigForKey.fromBlob = (blobId) => new ConfigForKey({ key, blobId });
  frames.set(key, ConfigForKey);
  return ConfigForKey;
};

markPublic(defineBlobConfig('logo'));
markPublic(defineBlobConfig('hero-image'));


////////////////////////////////////////////////////////////////////////////////
// EXPORT

module.exports = { Config };

