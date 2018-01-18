const Instance = require('./instance');
const { merge, mergeAll, pick } = require('ramda');

const fieldKeyFields = [ 'actorId', 'createdBy' ];
Object.freeze(fieldKeyFields);

// Like User, FieldKey presents a merged set of fields over the API between
// the FK and its associated Actor. But internally, the relationship is
// explicit: see the notes at the top of ./user.js for more.

// In addition, reified FieldKey objects also necessarily contain a
// session: Option[Session]. If the session has been revoked, it will necessarily
// be a truthful None. This helps with eg API responses and other internal code.

module.exports = Instance(({ FieldKey, Actor, Session, fieldKeys }) => class {

  // for now, our fields here are so simple that we may as well just form the
  // object from scratch.
  forCreate() { return { actorId: this.actor.id, createdBy: this.createdBy }; }

  // TODO: copy/pasta from ./user.js
  with(other) {
    const actor = new Actor(merge(this.actor, other.actor));
    return new FieldKey(mergeAll([ this, other, { actor } ]));
  }

  // TODO: again, copy/pasta from ./user.js (perhaps this is Trait-worthy?)
  static fromApi(data) {
    const actor = new Actor(merge(pick(Actor.fields(), data), { type: 'field_key' }));
    return new FieldKey(merge(pick(FieldKey.fields(), data), { actor, actorId: data.id }));
  }

  createSession() {
    return Session.fromActor(this.actor).with({ expiresAt: '9999-12-31T23:59:59z' }).create();
  }

  forApi() {
    const token = this.session.map((session) => session.token).orNull();
    return mergeAll([ this.without('actor', 'actorId', 'session'), this.actor.forApi(), { token } ]);
  }

  create() { return fieldKeys.create(this); }
  delete() { return this.actor.delete(); }

  static getAllGlobals() { return fieldKeys.getAllGlobals(); }
  static getByActorId(id) { return fieldKeys.getByActorId(id); }

  static fields() { return fieldKeyFields; }
});

