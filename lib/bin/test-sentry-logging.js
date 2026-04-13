const { run, task } = require('../task/task');
const { Sentry } = require('../external/sentry');

const [, , ...args] = process.argv;

task.withContainer((...args1) => async (...args2) => {
  if (args.length) throw new Error(args.join(' '));
  else throw new Error('testing');
})();
