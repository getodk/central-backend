// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const rename = (db, from, to) => db.update(to).where(from).into('grants');

const up = (db) => Promise.all([
  rename(db, { acteeId: 'form', verb: 'createSubmission' }, { acteeId: 'project', verb: 'submission.create' }),
  rename(db, { acteeId: 'form', verb: 'list' }, { acteeId: 'project', verb: 'form.list' }),
  rename(db, { acteeId: 'form', verb: 'read' }, { acteeId: 'project', verb: 'form.read' }),
]);

const down = (db) => Promise.all([
  rename(db, { acteeId: 'project', verb: 'submission.create' }, { acteeId: 'form', verb: 'createSubmission' }),
  rename(db, { acteeId: 'project', verb: 'form.list' }, { acteeId: 'form', verb: 'list' }),
  rename(db, { acteeId: 'project', verb: 'form.read' }, { acteeId: 'form', verb: 'read' }),
]);

module.exports = { up, down };

