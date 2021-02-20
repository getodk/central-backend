module.exports = {
  hash: (x) => Promise.resolve(x),
  compare: (x, y) => Promise.resolve(x === y)
};

