const { withDatabase, migrate } = require('../model/migrate');

withDatabase(require('config').get('default.database'))(migrate);
