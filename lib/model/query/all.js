
const { merge, all, reduce } = require('ramda');
const { FoldedFutureQuery } = require('./future-query');

const defModule = (transacting) => ({
  // Runs all the given queries in parallel in any order, returning an array
  // of results when everything completes.
  do: (ops) => (container) =>
    new FoldedFutureQuery(ops, { container, transacting }),

  // Runs all the given queries in parallel in any order, returning true only
  // if all the given queries return true.
  areTrue: (ops) => (container) =>
    new FoldedFutureQuery(ops, { container, transacting, fold: all((x) => x === true) }),

  // Runs all the given queries sequentially in the given order, then returns
  // an array of results when everything completes.
  inOrder: (ops) => () => {
    const [ head, ...tail ] = ops;
    const results = [];
    const push = (x) => results.push(x);

    const step = (previous, op) => previous.then(() => op.then(push));
    return reduce(step, head.then(push), tail).then(() => results);
  }
});

module.exports = merge(defModule(false), { transacting: defModule(true) });

