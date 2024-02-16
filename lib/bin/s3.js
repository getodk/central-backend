// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable no-use-before-define */

const config = require('config');
const { program } = require('commander');
const { sql } = require('slonik');

const { slonikPool } = require('../external/slonik');
const { exhaustBlobs } = require('../blob-worker');

program.command('count-failed-uploads').action(countFailed);
program.command('retry-failed-uploads').action(retryFailed);
program.command('upload-all').action(uploadAll);
program.parse();

function countFailed() {
  withDb(async (db) => console.log('Failed uploads:', await getFailedCount(db)));
}

function retryFailed() {
  withDb(async (db) => {
    const count = await db.oneFirst(sql`
      WITH affected AS (
        UPDATE blobs SET s3_status='pending' WHERE s3_status='failed'
        RETURNING 1
      )
      SELECT COUNT(*) FROM affected
    `);
    console.log(count, 'blobs marked for re-uploading.');
  });
}

function uploadAll() {
  withDb(async (db) => {
    console.log('Uploading', await getFailedCount(db), 'blobs...');
    await exhaustBlobs({ db });
    console.log('Upload completed.');
  });
}

function getFailedCount(db) {
  return db.oneFirst(sql`SELECT COUNT(*) FROM blobs WHERE s3_status='failed'`);
}

async function withDb(fn) {
  const db = slonikPool(config.get('default.database'));
  await fn(db);
  await db.end();
}
