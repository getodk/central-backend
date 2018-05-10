// Memberships are join entities indicating parent/child relationships between
// Actors. They are typically used to, for instance, add Users to Groups. The
// next major version of this project will likely allow inherited rights to be
// scoped.

const Instance = require('./instance');
const { withCreateTime } = require('../../util/instance');

module.exports = Instance(({ simply }) => class {
  forCreate() { return withCreateTime(this); }

  create() { return simply.create('memberships', this); }

  static fromActors(parent, child) { return new this({ parentActorId: parent.id, childActorId: child.id }); }
});

