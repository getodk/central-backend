const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'REPORT'];
const logLevel = process.env.LOG_LEVEL || 'INFO';

module.exports = suiteName => {
  const _log = (level, ...args) => {
    if (LOG_LEVELS.indexOf(logLevel) > LOG_LEVELS.indexOf(level)) return;
    console.log(`[${new Date().toISOString()}]`, level, `[${suiteName}]`, ...args);
  };
  const log  = (...args) => _log('INFO',   ...args);
  log.debug  = (...args) => _log('DEBUG',  ...args);
  log.info   = log;
  log.error  = (...args) => _log('ERROR',  ...args);
  log.report = (...args) => _log('REPORT', ...args);

  return log;
};
