// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.raw('drop trigger check_field_collisions on form_fields');
  // previously this read "for each row". bad.
  await db.raw(`create trigger check_field_collisions after insert on form_fields
    for each statement execute procedure check_field_collisions();`);
};

const down = () => {}; // no. no reason to allow this.

module.exports = { up, down };

