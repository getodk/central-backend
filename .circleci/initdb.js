const knex = require('knex');

(async () => {
  const dbmain = knex({ client: 'pg', connection: { host: 'localhost', user: 'postgres', database: 'postgres', password: 'odktest' } });
  await dbmain.raw("create user jubilant with password 'jubilant';");
  await dbmain.raw('create database jubilant_test with owner=jubilant encoding=UTF8;');
  /* uncomment to print all db statements to log.
  await dbmain.raw(`alter system set log_destination to 'stderr';`);
  await dbmain.raw(`alter system set logging_collector to on;`);
  await dbmain.raw(`alter system set log_statement to 'all';`);
  await dbmain.raw(`select pg_reload_conf();`);*/
  dbmain.destroy();

  const dbjt = knex({ client: 'pg', connection: { host: 'localhost', user: 'postgres', database: 'jubilant_test', password: 'odktest' } });
  await dbjt.raw('create extension citext;');
  await dbjt.raw('create extension pg_trgm;');
  await dbjt.raw('create extension "uuid-ossp";');
  dbjt.destroy();
})();

