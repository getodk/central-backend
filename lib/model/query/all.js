
const { merge, all } = require('ramda');
const { FoldedFutureQuery } = require('./future-query');

const defModule = (transacting) => ({
  do: (ops) => (container) =>
    new FoldedFutureQuery(ops, { container, transacting }),

  areTrue: (ops) => (container) =>
    new FoldedFutureQuery(ops, { container, transacting, fold: all((x) => x === true) })
});

module.exports = merge(defModule(false), { transacting: defModule(true) });

