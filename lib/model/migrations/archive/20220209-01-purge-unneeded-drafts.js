// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// This migration permanently purges all unpublished (draft) form defs that
// are no longer needed, e.g. a draft that was replaced by another draft without
// ever being published, or a draft replaced by an encrypted version when managed
// encryption was turned on for a project. For these unneeded (unattached) draft
// form defs, there is no reference on the form itself back to these form defs.

// NOTE: copypasta alert! The following SQL also appears in 'clearUnneededDrafts()'
// of lib/model/query/forms.js


const up = (db) =>
  db.raw(`
delete from form_defs
using forms
where form_defs."formId" = forms.id
and form_defs."publishedAt" is null
and form_defs.id is distinct from forms."draftDefId"`);

const down = () => {};

module.exports = { up, down };
