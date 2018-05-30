// Copyright 2017 Jubilant Garbanzo Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/nafundi/jubilant-garbanzo/blob/master/NOTICE.
// This file is part of Jubilant Garbanzo. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of Jubilant Garbanzo,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

module.exports = {
  // Will update the existing record of the given key if present, or else create it.
  set: (record) => ({ db }) =>
    db.raw('? on conflict (key) do update set value = ?, "setAt" = ?', [
      db.insert(record.with({ setAt: new Date() })).into('config'),
      record.value,
      new Date()
    ])
};

