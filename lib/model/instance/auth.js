const Instance = require('./instance');
const { reject } = require('../../reused/promise');
const Problem = require('../../problem');

module.exports = Instance(({ Grant }) => class {
  // See: Grant::can for behaviour. TODO: also see it for todo notes.
  // If no actor is present for this session, will check against anonymous rights.
  can(verb, actee) {
    return Grant.can(this.session.map((session) => session.actor), verb, actee);
  }

  // See: Actor#canOrReject for behaviour.
  // If no actor is present for this session, will check against anonymous rights.
  canOrReject(verb, actee) {
    return this.can(verb, actee).then((result) =>
      ((result === true) ? true : reject(Problem.user.insufficientRights())));
  }

  // simple helper since this is often required:
  actor() { return this.session.map((session) => session.actor); }
});

