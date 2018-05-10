// Contains tasks that get or set configuration in the database. See ./task.js
// for more information on what tasks are.

const { task } = require('./task');
const { getOrNotFound } = require('../util/promise');

// Get the entire Config Instance object for a given key. Rejects if not found.
const getConfiguration = task.withContainer(({ Config }) => (key) =>
  Config.get(key).then(getOrNotFound));

// Get just the value of the Config Instance object, as a parsed JSON object.
const getConfigurationJsonValue = (key) => getConfiguration(key).then((config) => JSON.parse(config.value));

// Sets some configuration k/v pair given (key: String, value: String).
const setConfiguration = task.withContainer(({ Config }) => Config.set);

module.exports = { getConfiguration, getConfigurationJsonValue, setConfiguration };

