const _log = level => (...args) => console.log(level, ...args); // eslint-disable-line no-console
global.log = _log('[INFO]');

async function mochaGlobalSetup() {
  log('mochaGlobalSetup() :: ENTRY');
  log('mochaGlobalSetup() :: EXIT');
}

function mochaGlobalTeardown() {
  log('mochaGlobalTeardown() :: ENTRY');
  log('mochaGlobalTeardown() :: EXIT');
}

module.exports = { mochaGlobalSetup, mochaGlobalTeardown };
