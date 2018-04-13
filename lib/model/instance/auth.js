const Instance = require('./instance');
const { reject } = require('../../util/promise');
const Problem = require('../../util/problem');
const Option = require('../../util/option');

module.exports = Instance(({ Grant }) => class {
  // See: Grant::can for behaviour. TODO: also see it for todo notes.
  // If no actor is present for this session, will check against anonymous rights.
  can(verb, actee) {
    return Grant.can(this.actor(), verb, actee);
  }

  // See: Actor#canOrReject for behaviour.
  // If no actor is present for this session, will check against anonymous rights.
  canOrReject(verb, actee) {
    return this.can(verb, actee).then((result) =>
      ((result === true) ? true : reject(Problem.user.insufficientRights())));
  }

  session() { return Option.of(this._session); }
  actor() {
    const bySession = this.session().map((session) => session.actor);
    return bySession.isDefined() ? bySession : Option.of(this._actor);
  }

  isAuthenticated() { return (this._session != null) || (this._actor != null); }
});

