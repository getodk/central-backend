const withCreateTime = (x) => x.with({ createdAt: new Date() });

module.exports = { withCreateTime };

