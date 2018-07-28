// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//

const { md5sum } = require('../../util/crypto');

const up = (knex) =>
  knex.schema.table('blobs', (blobs) => { blobs.string('md5', 32); })
    .then(() => {
      const { all, Blob, simply } = require('../package').withDefaults({ db: knex });

      // MINOR HACK: typically, blobs can never be updated; there is nothing to
      // update about them and they are immutable. but the simply.update query
      // expects a forUpdate() method. so we subclass it.
      class UpdatableBlob extends Blob {
        forUpdate() { return this; }
      }

      // now populate all md5sums on all extant blobs.
      return simply.transacting.getAll('blobs', UpdatableBlob)
        .then((blobs) => all.do(blobs.map((blob) =>
          simply.update('blobs', blob.with({ md5: md5sum(blob.content) }))))).point();
    });

const down = (knex) =>
  knex.schema.table('blobs', (blobs) => { blobs.dropColumn('md5'); });

module.exports = { up, down };

