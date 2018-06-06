// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
const up = (knex) => {
  const { Actor, Grant, all, simply } = require('../package').withDefaults({ db: knex });
  return Actor.getBySystemId('globalfk')
    .then((maybeGroup) => maybeGroup.get())
    .then((group) => all.do([
      simply.create('grants', new Grant({ actorId: group.id, verb: 'list', acteeId: 'form', system: true })),
      simply.create('grants', new Grant({ actorId: group.id, verb: 'read', acteeId: 'form', system: true }))
    ]))
    .point();
};
const down = () => null;

module.exports = { up, down };

