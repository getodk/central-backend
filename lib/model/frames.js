// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Frame, table, readable, writable } = require('./frame');

const Actor = Frame.define(
  table('actors'),
  'id',          readable,           'type',        readable,
  'acteeId',     readable,           'displayName', readable, writable,
  'meta',        readable,           'createdAt',   readable,
  'updatedAt',   readable,           'deletedAt',   readable
);

const Submission = Frame.define(
  table('submissions'),
  'id',          readable,           'formId',      readable,
  'instanceId',  readable,           'submitterId', readable,
  'deviceId',    readable,           'createdAt',   readable,
  'deletedAt',   readable
);

module.exports = { Actor, Submission };

