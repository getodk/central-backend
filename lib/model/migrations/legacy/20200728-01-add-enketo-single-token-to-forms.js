// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.


// NOTE: the column was renamed to enketoOnceId prior to PR merge but after
// this file was named. the file name has been preserved to not confuse the
// migrator for machines that have already run the provisional code.

const up = (db) => db.schema.table('forms', (forms) => {
  forms.text('enketoOnceId');
});

const down = (db) => db.schema.table('forms', (forms) => {
  forms.dropColumn('enketoOnceId');
});

module.exports = { up, down };

