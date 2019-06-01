// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { maybeFirst } = require('../../util/db');


module.exports = {
  // we could theoretically do an insert on conflict do nothing here, but
  // 1 returning the id in the extant case is tricky
  // 2 it requires writing the entire query in raw
  // 3 it means blindly sending the xml payload even if we don't have to
  // so for now at least we just do what blobs does and check the sha first.
  ensure: (xform) => ({ db }) =>
    db.select('id').from('xforms').where({ sha256: xform.sha256 })
      .then(maybeFirst)
      .then((extant) => extant
        .map(({ id }) => id)
        .orElseGet(() => db.insert(xform).into('xforms').returning('id')
          .then(([ id ]) => id)))
};

