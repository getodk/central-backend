const Instance = require('./instance');

module.exports = Instance(({ actees }) => class {
  create() { return actees.create(this); }
});

