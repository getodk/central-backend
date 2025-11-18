// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const updateMailingListOptIn = async ({ Users, UserPreferences, mailingListReporter }, event) => {

  if (!(event.details.propertyName === 'mailingListOptIn' && event.details.propertyValue === true))
    return;

  const user = await Users.getByActorId(event.actorId).then(o => o.get());
  // Double-check preference is set to opt-in
  const prefs = await UserPreferences.getForUser(user.actorId);
  if (prefs.site.mailingListOptIn)
    await mailingListReporter.submit({ email: user.email });

};

module.exports = { updateMailingListOptIn };
