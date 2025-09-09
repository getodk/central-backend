// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.


const fs = require('node:fs');
const path = require('path');


function getSqlFiles(upOrDown) {
  const prefix = /^(.+)\.js$/.exec(path.basename(__filename))[1];
  return fs.readdirSync(__dirname)
    .filter(fn => fn.startsWith(prefix) && fn.endsWith(`${upOrDown}.sql`))
    .sort()
    .map(fn => fs.readFileSync(
      path.join(__dirname, fn),
      'utf8'
    ).replace( // Because knex's .raw() isn't. Not in the way you want it to be. See https://github.com/knex/knex/issues/3112#issuecomment-818168096
      /\?/g,
      '\\?'
    ));
}


const down = async (db) => {
  getSqlFiles('down').forEach(async sql => {
    // See sidecar .sql files
    await db.raw(sql);
  });
};


const up = async (db) => {
  getSqlFiles('up').forEach(async sql => {
    // See sidecar .sql files
    await db.raw(sql);
  });
};


module.exports = { up, down };
