const { Subclass } = require('../util/util');
const AsActee = require('./trait/actee');
const Base = require('./base');


const actorTypes = { system: 'system', user: 'user', group: 'group', proxy: 'proxy' };

const Actor = Subclass(AsActee(Base), (superclass) => class extends superclass {
  get id() { return this.data.id; }

  static get type() { return actorTypes; }

  static _tableName() { return 'actors'; }
});

module.exports = Actor;


