// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable no-console */

const down = async (db) => {
  await db.raw('truncate table submission_field_extract_geo_cache');
};


const up = async (db) => {
  const BATCH_SIZE = 1000;
  const createCache = (batchSize) => db.raw(`SELECT cache_all_submission_geo(true, ${batchSize})`).then(res => res.rows[0].cache_all_submission_geo);
  const totalTodo = (await createCache(0))[1];
  if (totalTodo === 0) return;

  let totalDone = 0;
  const numberWidth = 1 + Math.floor(Math.log10(totalTodo));
  const padNumber = (theNumber) => theNumber.toString().padStart(numberWidth, ' ');
  console.info(`Prefilling cache of submission geofields: ${totalTodo} fields to process`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const [doneInBatch, leftTodo] = await createCache(BATCH_SIZE);
    totalDone += doneInBatch;
    console.info(`Done: ${padNumber(totalDone)} / Left: ${padNumber(leftTodo)}`);
    if (leftTodo === 0) break;
  }
};


module.exports = { up, down };
