const { withDatabase, checkMigrations } = require('../model/migrate');

withDatabase(require('config').get('default.database'))(checkMigrations);
