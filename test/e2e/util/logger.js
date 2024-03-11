module.exports = suiteName => {
  const _log = (level, ...args) => {
    console.log(`[${new Date().toISOString()}]`, `[${suiteName}]`, ...args);
  };
  const log  = (...args) => true  && _log('INFO',   ...args);
  log.debug  = (...args) => false && _log('DEBUG',  ...args);
  log.info   = log;
  log.error  = (...args) => true  && _log('ERROR',  ...args);
  log.report = (...args) => true  && _log('REPORT', ...args);

  return log;
};
