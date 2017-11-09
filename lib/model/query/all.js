
const { merge, all } = require('ramda');
const { futureQueryList } = require('./future-query');

const defModule = (transacting) => ({
  do: (ops) => (container) =>
    futureQueryList(ops, container, transacting),

  areTrue: (ops) => (container) =>
    futureQueryList(ops, container, transacting, all((x) => x === true))
});

module.exports = merge(defModule(false), { transacting: defModule(true) });

