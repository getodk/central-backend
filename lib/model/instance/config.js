// A simple key-value store for site configuration. Typically, but not always,
// the value is a JSON string. May change significantly in future versions.

const Instance = require('./instance');

module.exports = Instance(({ Config, simply, configs }) => class {
  static set(key, value) { return configs.set(new Config({ key, value })); }
  static unset(key) { return simply.delete('config', { key }, 'key'); }
  static get(key) { return simply.getOneWhere('config', { key }, Config); }
});

