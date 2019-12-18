// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Currently, we write audit logs to the database. This makes it easy to use them
// in determining, for example, the most recent login by a User. To log an audit
// record, use Audit.log().

const { merge } = require('ramda');
const { DateTime, Duration } = require('luxon');
const Instance = require('./instance');
const { ActeeSpeciesTrait } = require('../trait/actee');
const { ExtendedInstance, HasExtended } = require('../trait/extended');
const { QueryOptions } = require('../../util/db');
const Option = require('../../util/option');


// TODO: when it's more obvious where this should go, move it there.
const actionableEvents = [ 'submission.attachment.update' ];

const ExtendedAudit = ExtendedInstance({
  fields: {
    readable: [ 'actorId', 'actor', 'action', 'acteeId', 'actee', 'details', 'loggedAt' ]
  },
  forApi() {
    const actor = this.actor.map((x) => x.forApi()).orNull();
    const actee = this.actee.map((x) => x.forApi()).orNull();
    // we could do the whole superproto thing but all fields are readable for now
    // so we save some work by avoiding all that.
    return merge(this, { actor, actee });
  }
});

module.exports = Instance.with(
  ActeeSpeciesTrait('audits'),
  HasExtended(ExtendedAudit)
)('audits', {
  all: [ 'id', 'actorId', 'action', 'acteeId', 'details', 'loggedAt', 'claimed', 'processed', 'lastFailure', 'failures' ],
  readable: [ 'actorId', 'action', 'acteeId', 'details', 'loggedAt' ]
})(({ audits, Audit, simply }) => class {
  forCreate() { return this.with({ loggedAt: new Date() }); }

  create() { return simply.create('audits', this); }

  static log(actor, action, actee, details) {
    return Audit.of(actor, action, actee, details).create();
  }
  // guardrailed creation of Audit log instances.
  // actor may be Actor? or Option[Actor]; actee may be Actee? or Option[Actee];
  // details are Object?.
  static of(actor, action, actee, details) {
    // if the event needs no further processing, just mark it as processed already.
    const processed = actionableEvents.includes(action) ? null : new Date();
    return (new Audit({
      actorId: Option.of(actor).map((x) => x.id).orNull(),
      action,
      acteeId: Option.of(actee).map((x) => x.acteeId).orNull(),
      details,
      processed
    }));
  }

  // weird name to avoid shadowing.
  static logAll(auditz) { return simply.insert('audits', auditz.map((audit) => audit.forCreate())); }

  static getLatestByAction(action) { return audits.getLatestWhere({ action }); }
  static getLatestWhere(condition) { return audits.getLatestWhere(condition); }

  static get(options) { return audits.get(options); }

  // TODO: sort of deprecated, only used by weird backup data fetch:
  static getRecentByAction(action, duration = { days: 3 }) {
    const start = DateTime.local().minus(Duration.fromObject(duration));
    return audits.get(new QueryOptions({ args: { action, start } }));
  }
});

