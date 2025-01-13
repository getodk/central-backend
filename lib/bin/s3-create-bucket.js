// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Minio = require('minio');

const { server, region, bucketName, accessKey, secretKey } = require('config').get('default.external.s3blobStore');

const minioClient = (() => {
  const url = new URL(server);
  const useSSL = url.protocol === 'https:';
  const endPoint = (url.hostname + url.pathname).replace(/\/$/, '');
  const port = parseInt(url.port, 10);

  return new Minio.Client({ endPoint, port, useSSL, accessKey, secretKey });
})();

const log = (...args) => console.log(__filename, ...args);

minioClient.bucketExists(bucketName)
  .then(exists => {
    if (exists) {
      log('Bucket already exists.');
      return;
    }

    log('Creating bucket:', bucketName, 'in', region ?? 'default region');
    return minioClient.makeBucket(bucketName, region)
      .then(() => log('Bucket created OK.'));
  })
  .catch(err => {
    log('ERROR CREATING MINIO BUCKET:', err);
    process.exit(1);
  });
