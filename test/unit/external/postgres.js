const should = require('should');

const {
  _expectedExtensions,
  _checkExtensionVersions,
  validateDb,
} = require('../../../lib/external/postgres');

const fromDb = extensions => extensions.map(([ name, version ]) => ({ name, version }));

function mockPostgresWithVersion(version) {
  return {
    oneFirst(query) {
      switch (query.sql) {
        case 'SELECT 1': return 1;
        case `SELECT current_setting('server_version_num')::INT`: return version;
        default: throw new Error('Unexpected query: ' + JSON.stringify(query));
      }
    },
    any(query) {
      switch (query.sql) {
        case 'SELECT extname AS name, extversion AS version FROM pg_extension': return fromDb(_expectedExtensions);
        default: throw new Error('Unexpected query: ' + JSON.stringify(query));
      }
    },
  };
}

describe.only('external/postgres', () => {
  let mockProcess;
  let mockConsole;

  beforeEach(() => {
    mockProcess = {
      exit(statusCode) {
        if (this.exitCode !== undefined) throw new Error('process.exit() called multiple times');
        this.exitCode = statusCode;
        throw new Error(`process.exit(${statusCode})`);
      }
    };

    mockConsole = {
      logged: [],
      error(timestamp, prefix, ...message) {
        if (prefix === undefined) {
          timestamp
            .split('\n')
            .forEach(line => {
              const [ _ts, _prefix, ..._message ] = line.split(' ');
              this._appendLogLine(_ts, _prefix, _message);
            });
        } else {
          this._appendLogLine(timestamp, prefix, message);
        }
      },

      _appendLogLine(timestamp, prefix, message) {
        timestamp.should.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        prefix.should.eql('[central-backend|validateDb]');
        this.logged.push(message.join(' '));
      },
    };
  });

  const mockActualExtensions = extensions => () => fromDb(extensions);

  describe('_checkExtensionVersions()', () => {
    [
      [],
      _expectedExtensions,
    ].forEach((extensions, idx) => {
      it(`should be OK if all extensions exactly match expectations (Example #${idx+1})`, async () => {
        await _checkExtensionVersions(
          mockProcess,
          mockConsole,
          mockActualExtensions(extensions),
          extensions,
        );

        mockConsole.logged.should.deepEqual([
          'Checking PostgreSQL extensions...',
          'All expected extensions were found; checking version numbers...',
          'PostgreSQL extensions look OK.',
        ]);

        should(mockProcess.exitCode).be.undefined();
      });
    });
    [
      //|         expected          |     actual     | missing
      [ [ ['a','1.2']              ], [],              [ 'a' ] ],
      [ [ ['a','1.2'], ['b','3.4'] ], [],              [ 'a', 'b' ] ],
      [ [ ['a','1.2'], ['b','3.4'] ], [ ['a','1.2'] ], [ 'b' ] ],
      [ [ ['a','1.2'], ['b','3.4'] ], [ ['b','3.4'] ], [ 'a' ] ],
    ].forEach(([ expected, actual, missing ], idx) => {
      it(`should ___ if expected extension(s) are missing (Example #${idx+1})`, async () => {
        await _checkExtensionVersions(
          mockProcess,
          mockConsole,
          mockActualExtensions(actual),
          expected,
        )
          .should.be.rejectedWith('process.exit(1)');

        mockConsole.logged.should.deepEqual([
          'Checking PostgreSQL extensions...',
          'ERROR: Missing expected PostgreSQL extension(s):\n\n' + missing.map(name => `  * ${name}`).join('\n'),
        ]);

        should(mockProcess.exitCode).eql(1);
      });
    });

    // TODO test out of date
    // TODO test too new
  });

  describe('validateDb()', () => {
    describe('fatal errors', () => {
      it('should exit with error if simple query fails', async () => {
        await validateDb(mockProcess, mockConsole, {
          async oneFirst() {
            throw new Error('connection failed');
          },
        })
          .should.be.rejectedWith('process.exit(1)');

        mockConsole.logged.should.deepEqual([
          'Testing database connection...',
          'ERROR: connection failed',
        ]);

        should(mockProcess.exitCode).eql(1);
      });

      it('should exit with error if version check query throws', async () => {
        await validateDb(mockProcess, mockConsole, {
          async oneFirst(query) {
            if (query.sql === 'SELECT 1') return 1;
            else throw new Error('unexpected DB error');
          }
        })
          .should.be.rejectedWith('process.exit(1)');

        mockConsole.logged.should.deepEqual([
          'Testing database connection...',
          'Connection OK.',
          'Checking PostgreSQL version...',
          'ERROR: unexpected DB error',
        ]);

        should(mockProcess.exitCode).eql(1);
      });
    });

    describe('OK versions', () => {
      [
        [ 180004, 'correct version' ],
        [ 180005, 'minor version higher than expected' ],
      ].forEach(([ version, description ]) => {
        it(`should not warn if ${description} (${version})`, async () => {
          await validateDb(mockProcess, mockConsole, mockPostgresWithVersion(version));

          mockConsole.logged.should.deepEqual([
            'Testing database connection...',
            'Connection OK.',
            'Checking PostgreSQL version...',
            'PostgreSQL version OK.',
            'Checking PostgreSQL extensions...',
            'All expected extensions were found; checking version numbers...',
            'PostgreSQL extensions look OK.',
          ]);

          should(mockProcess.exitCode).be.undefined();
        });
      });
    });

    describe('Warnable versions', () => {
      [
        [ 180003, 'OLDER version: v18.3.  Please upgrade to the expected version.', 'minor version too low' ],
        [ 190012, 'NEWER version: v19.12.  This may have unexpected effects.', 'major version higher than expected' ],
      ].forEach(([ version, warning, description ]) => {
        it(`should not warn if ${description} (${version})`, async () => {
          await validateDb(mockProcess, mockConsole, mockPostgresWithVersion(version));

          mockConsole.logged.should.deepEqual([
            'Testing database connection...',
            'Connection OK.',
            'Checking PostgreSQL version...',
            `WARN: Expected PostgreSQL v18.4 but found ${warning}`,
            'Checking PostgreSQL extensions...',
            'All expected extensions were found; checking version numbers...',
            'PostgreSQL extensions look OK.',
          ]);

          should(mockProcess.exitCode).be.undefined();
        });
      });
    });

    describe('Fatal versions', () => {
      it('should exit with error if major version is too low', async () => {
        await validateDb(mockProcess, mockConsole, mockPostgresWithVersion(120034))
          .should
          .be
          .rejectedWith('process.exit(1)');

        mockConsole.logged.should.deepEqual([
          'Testing database connection...',
          'Connection OK.',
          'Checking PostgreSQL version...',
          'ERROR: Expected PostgreSQL v18.4 but found OLDER version: v12.34.  Please upgrade to the expected version.',
        ]);

        should(mockProcess.exitCode).eql(1);
      });
    });
  });
});
