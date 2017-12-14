const Instance = require('./instance');
const { withCreateTime } = require('../../util/instance');
const { resolve } = require('../../reused/promise');
const Option = require('../../reused/option');

module.exports = Instance(({ simply }) => class {
  forCreate() { return withCreateTime(this); }

  create() { return simply.create('memberships', this); }

  static fromActors(parent, child) { return new this({ parentActorId: parent.id, childActorId: child.id }); }
});


