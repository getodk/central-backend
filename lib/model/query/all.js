
const { merge, all, reduce } = require('ramda');
const { FoldedFutureQuery } = require('./future-query');

const defModule = (transacting) => ({
  do: (ops) => (container) =>
    new FoldedFutureQuery(ops, { container, transacting }),

  areTrue: (ops) => (container) =>
    new FoldedFutureQuery(ops, { container, transacting, fold: all((x) => x === true) }),

  inOrder: (ops) => () => {
    const [ head, ...tail ] = ops;
    const results = [];
    const push = (x) => results.push(x);

    const step = (previous, op) => previous.then(() => op.then(push));
    return reduce(step, head.then(push), tail).then(() => results);
  }
});

module.exports = merge(defModule(false), { transacting: defModule(true) });

