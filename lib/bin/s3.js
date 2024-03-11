// Copyright 2024 ODK Central Developers
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
const pg = require('pg');

const { exhaustBlobs } = require('../util/s3');

program.command('count-blobs <status>').action(count);
program.command('reset-failed-as-pending').action(setFailedToPending);
program.command('upload-pending').action(uploadPending);
program.parse();

function count(status) {
  withDb(async (db) => log(await getCount(db, status)));
}

function setFailedToPending() {
  withDb(async (db) => {
    const { rows } = await db.query(`
      WITH updated AS (
        UPDATE blobs SET s3_status='pending' WHERE s3_status='in_progress' RETURNING 1
      )
      SELECT COUNT(*) FROM updated
    `);
    const changeCount = rows[0].count;
    log(changeCount, 'blobs marked for re-uploading.');
  });
}

function uploadPending() {
  withDb(async (db) => {
    console.log('uploadPending:', db);
    log('Uploading', await getCount(db, 'pending'), 'blobs...');
    await exhaustBlobs({ db });
    log('Upload completed.');
  });
}

async function getCount(db, status) {
  const { rows } = await db.query(`SELECT COUNT(*) FROM blobs WHERE s3_status=$1`, [status]);
  return rows[0].count;
}

async function withDb(fn) {
  let exitCode = 0;

  const client = new pg.Client(config.get('default.database'));
  await client.connect();

  try {
    await fn(client);
  } catch (err) {
    console.log(err);
    exitCode = 1;
  } finally {
    console.log('calling client.end...');
    await client.end();
    console.log('client ended');
    // TODO something is keeping the DB open, but this at least sorts it out.
    process.exit(exitCode);
  }
}
