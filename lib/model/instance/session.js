
const { reject } = require('../../reused/promise');
const { withCreateTime } = require('../../util/instance');
const Instance = require('./instance');
const Problem = require('../../problem');
const Option = require('../../reused/option');
const { randomBytes } = require('crypto');

module.exports = Instance(({ Actor, Session, Grant, simply, sessions, grants }) => class {
  // See: Grant::can for behaviour. TODO: also see it for todo notes.
  // If no actor is present for this session, will check against anonymous rights.
  can(verb, actee) { return Grant.can(this.actor, verb, actee); }

  // See: Actor#canOrReject for behaviour.
  // If no actor is present for this session, will check against anonymous rights.
  canOrReject(verb, actee) {
    return this.can(verb, actee).then((result) =>
      (result === true) ? true : reject(Problem.user.insufficientRights()));
  }

  forCreate() { return withCreateTime(this); }
  create() { return simply.create('sessions', this); }

  forApi() { return this.without('actorId'); }

  static fromActor(actor) {
    const expires = new Date();
    expires.setDate(expires.getDate() + 1);

    return new Session({
      actorId: actor.id,
      token: randomBytes(48).toString('base64'),
      expires
    });
  }

  static getByBearerToken(token) {
    return sessions.getByBearerToken(token)
      // TODO: awkward commuting homework.
      .then((maybeSession) => maybeSession.isDefined()
        ? Actor.getById(maybeSession.get().actorId)
            .then((actor) => maybeSession.map((x) => x.with({ actor })))
        : Option.none());
  }

  // TODO: singleton
  static none() { return new Session({ actor: Option.none() }); }
});

