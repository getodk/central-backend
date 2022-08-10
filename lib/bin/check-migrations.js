const { withDatabase, checkMigrations } = require('../model/migrate');

(async () => {
  try {
    await withDatabase(require('config').get('default.database'))(checkMigrations);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
