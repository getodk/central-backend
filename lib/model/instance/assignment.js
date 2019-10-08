// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.


const Instance = require('./instance');
const { ExtendedInstance, HasExtended } = require('../trait/extended');
const { ActeeSpeciesTrait } = require('../trait/actee');

const ExtendedAssignment = ExtendedInstance({
  // since we override forApi these readable fields don't actually do anything besides be informative.
  fields: { readable: [ 'actor', 'roleId' ] },
  forApi() { return { actor: this.actor.forApi(), roleId: this.roleId }; }
});

const ExtendedFormSummaryAssignment = ExtendedInstance({
  // ditto above
  fields: { readable: [ 'actor', 'roleId', 'form' ] },
  forApi() { return { actor: this.actor.forApi(), roleId: this.roleId, xmlFormId: this.form.xmlFormId }; }
});

module.exports = Instance.with(
  HasExtended(ExtendedAssignment),
  HasExtended(ExtendedFormSummaryAssignment, 'FormSummary'),
  ActeeSpeciesTrait('assignment')
)('assignments', {
  all: [ 'actorId', 'roleId' ],
  readable: [ 'actorId', 'roleId' ]
})(({ assignments }) => class {

  // for now, these methods only take actee IDs specifically and not actee instances
  // since they are for management/accounting, not for auth checking.
  static getByActeeId(acteeId, options) {
    return assignments.getByActeeId(acteeId, options);
  }

  static getByActeeAndRoleId(acteeId, roleId, options) {
    return assignments.getByActeeAndRoleId(acteeId, roleId, options);
  }

  // similar for these, which service a read-only forms assignments api.
  // TODO: these names kind of suck.
  static getForFormsByProjectId(projectId, options) {
    return assignments.getForFormsByProjectId(projectId, options);
  }
  static getForFormsByProjectAndRoleId(projectId, roleId, options) {
    return assignments.getForFormsByProjectAndRoleId(projectId, roleId, options);
  }
});

