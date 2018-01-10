
const { resolve, reject } = require('../../reused/promise');
const { withCreateTime } = require('../../util/instance');
const Instance = require('./instance');
const Problem = require('../../problem');
const Option = require('../../reused/option');
const { randomBytes } = require('crypto');

module.exports = Instance(({ Actor, Session, Grant, simply, sessions }) => class {
  // See: Grant::can for behaviour. TODO: also see it for todo notes.
  // If no actor is present for this session, will check against anonymous rights.
  can(verb, actee) { return Grant.can(this.actor, verb, actee); }

  // See: Actor#canOrReject for behaviour.
  // If no actor is present for this session, will check against anonymous rights.
  canOrReject(verb, actee) {
    return this.can(verb, actee).then((result) =>
      ((result === true) ? true : reject(Problem.user.insufficientRights())));
  }

  forCreate() { return withCreateTime(this); }
  create() { return simply.create('sessions', this); }

  forApi() { return this.without('actorId'); }

  actorOrReject(problem = Problem.user.insufficientRights()) {
    // this code is impossible, since reject auto-fires:
    // return this.actor.map(resolve).orElse(reject(problem));
    return this.actor.isDefined() ? resolve(this.actor.get()) : reject(problem);
  }

  static fromActor(actor) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 1);

    return new Session({
      actorId: actor.id,
      token: randomBytes(48).toString('base64'),
      expiresAt
    });
  }

  static getByBearerToken(token) {
    return sessions.getByBearerToken(token)
      // TODO: awkward commuting homework.
      .then((maybeSession) => (maybeSession.isDefined()
        ? Actor.getById(maybeSession.get().actorId)
          .then((actor) => maybeSession.map((x) => x.with({ actor })))
        : Option.none()));
  }

  // TODO: singleton
  static none() { return new Session({ actor: Option.none() }); }
});

