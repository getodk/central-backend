// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// Delete draft Submissions that don't have any definition - cb#911
const up = async (db) => {
  await db.raw(`
  DELETE FROM submissions s 
  WHERE draft AND id IN ( 
    SELECT s.id FROM submissions s 
    LEFT JOIN submission_defs sd ON s.id = sd."submissionId" 
    WHERE sd.id IS NULL
  )`);
};

const down = () => {};

module.exports = { up, down };


