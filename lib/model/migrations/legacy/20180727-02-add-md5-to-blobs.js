// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//

const { md5sum } = require('../../util/crypto'); // eslint-disable-line no-restricted-modules

const up = (knex) =>
  knex.schema.table('blobs', (blobs) => { blobs.string('md5', 32); })
    .then(() => knex.select('*').from('blobs')
      .then((blobs) => Promise.all(blobs.map((blob) =>
        knex.update({ md5: md5sum(blob.content) }).into('blobs').where({ id: blob.id })))))
    .then(() => knex.schema.table('blobs', (blobs) => { blobs.string('md5', 32).notNull().alter(); }));

const down = (knex) =>
  knex.schema.table('blobs', (blobs) => { blobs.dropColumn('md5'); });

module.exports = { up, down };

