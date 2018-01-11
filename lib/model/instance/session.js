
const { resolve, reject } = require('../../reused/promise');
const { withCreateTime } = require('../../util/instance');
const Instance = require('./instance');
const Problem = require('../../problem');
const Option = require('../../reused/option');
const { generateToken } = require('../../util/util');


module.exports = Instance(({ Actor, Session, Grant, simply, sessions }) => class {
  forCreate() { return withCreateTime(this); }
  create() { return simply.create('sessions', this); }

  forApi() { return this.without('actorId'); }

  static fromActor(actor) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 1);
    return new Session({ actorId: actor.id, token: generateToken(), expiresAt });
  }

  // Returns Option[Session]. The resulting session object, if present, contains
  // a definite Actor. If an Actor could not be found to associate with this
  // session, the found session is invalid and None is returned overall.
  // TODO: do this via join rather than two-phase for perf. (but this will require
  // detangling the resulting fields)
  static getByBearerToken(token) {
    return sessions.getByBearerToken(token)
      // TODO: awkward commuting homework.
      .then((maybeSession) => (maybeSession.isDefined()
        ? Actor.getById(maybeSession.get().actorId)
          .then((actor) => actor.map((actor) => maybeSession.map((session) => session.with({ actor }))))
        : Option.none()));
  }
});

