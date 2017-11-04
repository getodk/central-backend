
const { isBlank, resolve, reject } = require('../../util/util');
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

  // Wraps a service, and injects the appropriate session information given the
  // appropriate credentials. If the given credentials don't match a session, aborts
  // with a 401. If no credentials are given, injects an empty session.
  //
  // TODO/CR: should this simply be an always-applied prefilter?
  static decorate(f) {
    return (request, response, next) => {
      const authHeader = request.get('Authorization');
      if (!isBlank(authHeader) && authHeader.startsWith('Bearer ')) {
        return sessions.getByBearerToken(authHeader.slice(7)).then((session) => {
          if (!session.isDefined())
            return reject(Problem.user.authenticationFailed());

          request.session = session.get();
          return f(request, response, next);
        })
      } else {
        request.session = Session.none();
        return f(request, response, next);
      }
    };
  }

  // TODO: singleton
  static none() { return new Session(); }
});

