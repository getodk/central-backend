const { task } = require('./task');
const { getOrNotFound } = require('../util/promise');

const getConfiguration = task.withContainer(({ Config }) => (key) =>
  Config.get(key)
    .then(getOrNotFound)
    .then((x) => JSON.parse(x.value)));

const setConfiguration = task.withContainer(({ Config }) => (key, value) =>
  Config.set(key, value));

module.exports = { getConfiguration, setConfiguration };

