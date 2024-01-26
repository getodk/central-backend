// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const Minio = require('minio');

const { server, bucketName } = require('config').get('default').s3blobStore;

const accessKey = 'odk-central-dev';
const secretKey = 'topSecret123';

const minioClient = (() => {
  const url = new URL(server);
  const useSSL = url.protocol === 'https:';
  const endPoint = (url.hostname + url.pathname).replace(/\/$/, '');
  const port = parseInt(url.port, 10);

  return new Minio.Client({ endPoint, port, useSSL, accessKey, secretKey });
})();

const log = (...args) => console.log(__filename, ...args);

log('Creating bucket:', bucketName);
minioClient.makeBucket(bucketName)
  .then(() => log('Bucket created OK.'))
  .catch(err => {
    log('ERROR CREATING MINIO BUCKET:', err);
  });
