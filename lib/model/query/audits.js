const { DateTime, Duration } = require('luxon');
const { maybeRowToInstance, rowsToInstances } = require('../../util/db');

module.exports = {
  getLatestWhere: (condition) => ({ db, Audit }) =>
    db.select('*').from('audits')
      .where(condition)
      .orderBy('loggedAt', 'desc')
      .limit(1)
      .then(maybeRowToInstance(Audit)),

  getRecentWhere: (condition, duration = { days: 3 }) => ({ db, Audit }) =>
    db.select('*').from('audits')
      .where(condition)
      .where('loggedAt', '>=', DateTime.local().minus(Duration.fromObject(duration)))
      .orderBy('loggedAt', 'desc')
      .then(rowsToInstances(Audit))
};

