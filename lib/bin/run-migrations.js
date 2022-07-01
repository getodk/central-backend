const { withDatabase, migrate } = require('../model/migrate');

(async () => {
  try {
    await withDatabase(require('config').get('default.database'))(migrate);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
