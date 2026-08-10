const log = level => (...args) => console.log('[INFO]', ...args); // eslint-disable-line no-console

async function mochaGlobalSetup() {
  log('mochaGlobalSetup() :: ENTRY');
  log('mochaGlobalSetup() :: EXIT');
}

function mochaGlobalTeardown() {
  log('mochaGlobalTeardown() :: ENTRY');
  log('mochaGlobalTeardown() :: EXIT');
}

module.exports = { mochaGlobalSetup, mochaGlobalTeardown };
