const { reduce } = require('ramda');

const plain = (x) => JSON.parse(JSON.stringify(x));

// Given an array of any kind of data and a mapping function f that translates
// each entry into a database operation, runs all the operations in guaranteed
// sequential order and returns all results.
// TODO/SL test this
const mapSequential = (xs, f) => {
  const [ head, ...tail ] = xs;
  const results = [];
  const push = (x) => results.push(x);

  const step = (previous, x) => previous.then(() => f(x).then(push));
  return reduce(step, f(head).then(push), tail).then(() => results);
};

module.exports = { plain, mapSequential };

