const { sql } = require('slonik');
const { ascend, curry, equals, prop, slice, sortWith } = require('ramda');

const { testContainer } = require('../setup');

const startsWith = curry((prefix, arr) => equals(prefix, slice(0, prefix.length, arr)));

const idxNameFor = fk => `idx_fk_${fk.local_tbl_name}_${fk.local_col_names}`;
const colsForIdx = fk => fk.local_col_names.map(col => `"${col}"`).join(', ');
const createIdxStatement = fk => `CREATE UNIQUE? INDEX ${idxNameFor(fk)} ON "${fk.local_tbl_name}" (${colsForIdx(fk)});`;

describe('database indexes', () => {
  it('should define indexes on both sides of foreign key relationships', testContainer(async ({ all }) => {
    const existingIndexes = await all(sql`
      SELECT tbl_class.relnamespace::regnamespace::text AS tbl_schema
           , tbl_class.relname AS tbl_name
           , idx_class.relname AS idx_name
           , pg_index.indkey::int2[] AS indexed_columns
        FROM pg_index
        JOIN pg_class AS idx_class ON idx_class.oid=pg_index.indexrelid
        JOIN pg_class AS tbl_class ON tbl_class.oid=pg_index.indrelid
        WHERE tbl_class.relnamespace::regnamespace::text NOT LIKE 'pg_%'
    `);

    const foreignKeys = await all(sql`
    SELECT   local_tbl_class.relnamespace::regnamespace::text AS   local_tbl_schema
         ,   local_tbl_class.relname                          AS   local_tbl_name
         , foreign_tbl_class.relnamespace::regnamespace::text AS foreign_tbl_schema
         , foreign_tbl_class.relname                          AS foreign_tbl_name
         , pg_constraint.conname AS fk_name
         , pg_constraint. conkey AS   local_col_indexes
         , pg_constraint.confkey AS foreign_col_indexes
      FROM pg_constraint
      JOIN pg_class AS   local_tbl_class ON   local_tbl_class.oid=pg_constraint. conrelid
      JOIN pg_class AS foreign_tbl_class ON foreign_tbl_class.oid=pg_constraint.confrelid
      WHERE pg_constraint.contype = 'f'
    `);

    const fkIndexes = [];
    const missingIndexes = foreignKeys
      .filter(fk => {
        const colsMatch = startsWith(fk.local_col_indexes);
        const foundIdx = existingIndexes.find(idx => { // eslint-disable-line arrow-body-style
          return idx.tbl_schema === fk.local_tbl_schema &&
                 idx.tbl_name   === fk.local_tbl_name && // eslint-disable-line no-multi-spaces
                 colsMatch(idx.indexed_columns);
        });
        if (!foundIdx) return true;

        fkIndexes.push({
          'FK table': fk.local_tbl_name,
          'foreign key': fk.fk_name,
          'database index': foundIdx.idx_name,
        });
        return false;
      });

    const envVarName = 'DEBUG_FK_INDEXES'
    if (process.env[envVarName]) {
      console.log('\n┌── Foreign Key Reverse Indexes ───────┐'); // eslint-disable-line no-console
      console.table( // eslint-disable-line no-console
        sortWith([
          ascend(prop('FK table')),
          ascend(prop('foreign key')),
          ascend(prop('database index')),
        ])(fkIndexes),
      );
    }

    await Promise.all(missingIndexes
      .map(async fk => {
        const cols = await all(sql`
          SELECT column_name      AS name
               , ordinal_position AS pos
            FROM information_schema.columns
            WHERE table_schema = ${fk.local_tbl_schema}
              AND table_name   = ${fk.local_tbl_name}
        `);

        // eslint-disable-next-line no-param-reassign
        fk.local_col_names = fk.local_col_indexes.map(pos => cols.find(c => c.pos === pos).name);
      }),
    );

    missingIndexes.length.should.eql(0, `${missingIndexes.length} foreign key indexes are missing from the database.

      Either: exceptions should be added to: ${__filename}
      Or:     a database migration should be added with the following indexes:

        ${missingIndexes.map(createIdxStatement).sort().join('\n        ')}

      To see existing indexes, run:

        ${envVarName}=1 npx mocha ${__filename}
    `);
  }));
});

