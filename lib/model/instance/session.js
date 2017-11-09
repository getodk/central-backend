
const { reject } = require('../../reused/promise');
const Instance = require('./instance');
const Problem = require('../../problem');
const Option = require('../../reused/option');

module.exports = Instance(({ Session, Grant, sessions, grants }) => class {

  _initialize() {
    this.actor = Option.of(this.actor);
  }

  // See: Grant::can for behaviour. TODO: also see it for todo notes.
  // If no actor is present for this session, will check against anonymous rights.
  can(verb, actee) { return Grant.can(this.actor, verb, actee); }

  // See: Actor#ifCan for behaviour.
  // If no actor is present for this session, will check against anonymous rights.
  ifCan(verb, actee) {
    return this.can(verb, actee).then((result) =>
      (result === true) ? resolve(true) : reject(Problem.user.insufficientRights()));
  }

  // TODO: singleton
  static none() { return new Session(); }
});

