const { merge } = require('ramda');

const withCreateTime = (x) => merge(x, { createdAt: new Date() });

module.exports = { withCreateTime };

