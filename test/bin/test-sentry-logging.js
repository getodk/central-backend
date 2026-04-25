const { task } = require('../../lib/task/task');

const [, , ...args] = process.argv;

task.withContainer(() => async () => {
  if (args.length) throw new Error(args.join(' '));
  else throw new Error('testing');
})();
