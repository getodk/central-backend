/* This file isn't used by circleci but it parallels the 
  circleci test database setup to set up BOTH the test
  database and working dev database. */
const knex = require('knex');

(async () => {
  const dbmain = knex({ client: 'pg', connection: { host: 'localhost', user: 'postgres', database: 'postgres', password: 'odktest' } });
  await dbmain.raw("create user jubilant with password 'jubilant';");
  await dbmain.raw('create database jubilant_test with owner=jubilant encoding=UTF8;');
  await dbmain.raw('create database jubilant with owner=jubilant encoding=UTF8;');
  dbmain.destroy();

  const dbjt = knex({ client: 'pg', connection: { host: 'localhost', user: 'postgres', database: 'jubilant_test', password: 'odktest' } });
  await dbjt.raw('create extension citext;');
  await dbjt.raw('create extension pg_trgm;');
  dbjt.destroy();

  const dbj = knex({ client: 'pg', connection: { host: 'localhost', user: 'postgres', database: 'jubilant', password: 'odktest' } });
  await dbj.raw('create extension citext;');
  await dbj.raw('create extension pg_trgm;');
  dbj.destroy();
})();

