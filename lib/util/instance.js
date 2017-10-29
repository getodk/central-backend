const { merge } = require('./util');

const withCreateTime = (x) => merge(x, { createdAt: new Date() });

module.exports = { withCreateTime };

