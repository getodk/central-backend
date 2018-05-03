const { task } = require('./task');
const { getOrNotFound } = require('../util/promise');

const getConfiguration = task.withContainer(({ Config }) => (key) =>
  Config.get(key).then(getOrNotFound));

const getConfigurationJsonValue = (key) => getConfiguration(key).then((config) => JSON.parse(config.value));

const setConfiguration = task.withContainer(({ Config }) => Config.set);

module.exports = { getConfiguration, getConfigurationJsonValue, setConfiguration };

