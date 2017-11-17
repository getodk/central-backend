const withCreateTime = (x) => x.with({ createdAt: new Date() });
const withUpdateTime = (x) => x.with({ updatedAt: new Date() });

module.exports = { withCreateTime, withUpdateTime };

