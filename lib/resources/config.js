// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Config } = require('../model/frames');
const { isBlank } = require('../util/util');
const { success } = require('../util/http');
const Problem = require('../util/problem');
const { reject, getOrNotFound } = require('../util/promise');
const { Blob } = require('../model/frames/blob');
const { maskedBlobResponse } = require('../util/blob');

// A frame subclass should be defined for each config key: see
// lib/model/frames/config.js.

const checkSettable = (key) => {
  const frame = Config.forKey(key);
  if (frame.fromValue != null || frame.fromBlob != null) return;
  throw Problem.user.unexpectedValue({
    field: 'key',
    value: key,
    reason: 'the config is unknown or cannot be set.'
  });
};

module.exports = (service, endpoint, anonymousEndpoint) => {
  service.post('/config/:key', endpoint(async ({ Blobs, Configs }, { auth, params, body, headers }, request) => {
    await auth.canOrReject('config.set', Config.species);
    checkSettable(params.key);
    const frame = Config.forKey(params.key);

    // Configs that store JSON values
    if (frame.fromValue != null) return Configs.set(frame.fromValue(body));

    // Configs that store blobs
    const contentType = headers['content-type'];
    if (isBlank(contentType))
      return reject(Problem.user.invalidHeader({ field: 'Content-Type', value: contentType }));
    const blob = await Blob.fromStream(request, contentType);
    const blobId = await Blobs.ensure(blob);
    return Configs.set(frame.fromBlob(blobId));
  }));

  service.get('/config/public', anonymousEndpoint(async ({ Configs }) => {
    const configs = await Configs.getAll();
    const result = Object.create(null);
    for (const config of configs) {
      if (config.constructor.isPublic) result[config.key] = config.forApi();
    }
    return result;
  }));

  const getConfig = async ({ s3, Blobs, Configs }, key) => {
    const config = await Configs.get(key).then(getOrNotFound);

    console.log('config.getConfig()', config);

    // Configs that store JSON values
    if (config.blobId == null) return config;

    // Configs that store blobs
    const blob = await Blobs.getById(config.blobId).then(getOrNotFound);
    return maskedBlobResponse(s3, key, blob, true);
  };

  service.get('/config/public/:key', anonymousEndpoint(async (container, { params }) => {
    const { key } = params;
    const frame = Config.forKey(key);
    return frame.isPublic
      ? getConfig(container, key)
      : Problem.user.insufficientRights();
  }));

  service.get('/config/:key', endpoint(async (container, { auth, params }) => {
    await auth.canOrReject('config.read', Config.species);
    return getConfig(container, params.key);
  }));

  // Returns 200 regardless of whether the config is actually set (making the
  // operation idempotent).
  service.delete('/config/:key', endpoint(async ({ Configs }, { auth, params }) => {
    await auth.canOrReject('config.set', Config.species);
    checkSettable(params.key);
    await Configs.unset(params.key);
    return success();
  }));
};

