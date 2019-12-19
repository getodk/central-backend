// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This task sends one of each possible email to the given recipient address.

const { always } = require('ramda');
const { task } = require('./task');
const { messages } = require('../outbound/mail');

const token = 'thisisatest!thisisatest!thisisatest!thisisatest!thisisatest!done';
const testEmail = task.withContainer(({ mail }) => (recipient) => {
  const send = (id, data) => mail(recipient, id, data).then(always(`sent message ${id}`));

  return Promise.all([
    send('accountCreated', { token }),
    send('accountEmailChanged', { oldEmail: 'this-is-a-test@opendatakit.org', newEmail: recipient }),
    send('accountReset', { token }),
    send('accountResetFailure'),
    send('accountResetDeleted'),
    send('accountPasswordChanged')
  ]);
});

module.exports = { testEmail };

