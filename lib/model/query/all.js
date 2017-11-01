
const { merge } = require('../../util/util');
const { futureQueryList } = require('./futureQuery');

const all = (transacting) => ({
  do: (ops) => (container) => futureQueryList(ops, container, transacting),

  areTrue: (ops) => (container) => {
    const allTrue = (xs) => {
      for (const x of xs) if (x !== true) return false;
      return true;
    };
    return futureQueryList(ops, container, transacting, allTrue);
  }
});

module.exports = merge(all(false), { transacting: all(true) });

