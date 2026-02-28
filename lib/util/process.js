const { once } = require('node:events');


// Gleaned from https://github.com/nodejs/node/issues/59994#issuecomment-3336060262
const awaitSpawnee = async (spawnee) => {
  const [ exitcode ] = await once(spawnee, 'close');
  if (exitcode !== 0) {
    const err = new Error(`process exited with code: ${exitcode}, spawnfile: ${spawnee.spawnfile}, args: ${spawnee.spawnargs}`);
    err.exitcode = exitcode;
    throw err;
  }
};

module.exports = {
  awaitSpawnee,
};
