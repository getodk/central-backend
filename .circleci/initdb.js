const knex = require('knex');

(async () => {
  const dbmain = knex({ client: 'pg', connection: { host: 'localhost', user: 'postgres', database: 'postgres' } });
  await dbmain.raw("create user jubilant with password 'jubilant';");
  await dbmain.raw('create database jubilant_test with owner=jubilant encoding=UTF8;');
  dbmain.destroy();

  const dbjt = knex({ client: 'pg', connection: { host: 'localhost', user: 'postgres', database: 'jubilant_test' } });
  await dbjt.raw('create extension citext;');
  await dbjt.raw('create extension pg_trgm;');
  dbjt.destroy();
})();

