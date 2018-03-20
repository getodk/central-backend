const { maybeRowToInstance } = require('../../util/db');

module.exports = {
  getLatestWhere: (condition) => ({ db, Audit }) =>
    db.select('*').from('audits').where(condition).orderBy('loggedAt', 'desc').limit(1)
      .then(maybeRowToInstance(Audit))
};

