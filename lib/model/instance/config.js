const Instance = require('./instance');
const shasum = require('sha');
const { readFile } = require('fs');
const { ExplicitPromise } = require('../../util/promise');

module.exports = Instance(({ Config, simply, config }) => class {
  forApi() { return this.value };

  static set(key, value) { return config.set(new Config({ key, value })); }
  static unset(key) { return simply.delete('config', { key }, 'key'); }
  static get(key) { return simply.getOneWhere('config', { key }, Config); }
});

