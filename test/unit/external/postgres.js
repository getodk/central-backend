const should = require('should');

const { validateDb } = require('../../../lib/external/postgres');

function mockPostgresWithVersion(version) {
  return {
    async oneFirst(query) {
      switch (query.sql) {
        case 'SELECT 1': return 1;
        case `SELECT current_setting('server_version_num')::INT`: return version;
        default: throw new Error('Unexpected query: ' + JSON.stringify(query));
      }
    }
  };
}

describe.only('external/postgres', () => {
  describe('validateDb()', () => {
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

    it('should exit with error if simple query fails', async () => {
      await validateDb(mockProcess, mockConsole, { async oneFirst() { throw new Error('connection failed'); } })
        .should
        .be
        .rejectedWith('process.exit(1)');

      mockConsole.logged.should.deepEqual([
        'Testing database connection...',
        '',
        'ERROR:',
        '',
        '    connection failed',
        '',
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
        .should
        .be
        .rejectedWith('process.exit(1)');

      mockConsole.logged.should.deepEqual([
        'Testing database connection...',
        'Connection OK.',
        'Checking PostgreSQL version...',
        '',
        'ERROR:',
        '',
        '    unexpected DB error',
        '',
      ]);

      should(mockProcess.exitCode).eql(1);
    });

    it('should exit with error if major version is too low', async () => {
      await validateDb(mockProcess, mockConsole, mockPostgresWithVersion(120034))
        .should
        .be
        .rejectedWith('process.exit(1)');

      mockConsole.logged.should.deepEqual([
        'Testing database connection...',
        'Connection OK.',
        'Checking PostgreSQL version...',
        '',
        'ERROR:',
        '',
        '    Expected PostgreSQL v14.23 but found OLDER version: v12.34.  Please upgrade to the expected version.',
        '',
      ]);

      should(mockProcess.exitCode).eql(1);
    });

    it('should warn if minor version is too low', async () => {
      await validateDb(mockProcess, mockConsole, mockPostgresWithVersion(140001));

      mockConsole.logged.should.deepEqual([
        'Testing database connection...',
        'Connection OK.',
        'Checking PostgreSQL version...',
        'WARN: Expected PostgreSQL v14.23 but found OLDER version: v14.1.  Please upgrade to the expected version.',
      ]);

      should(mockProcess.exitCode).be.undefined();
    });

    it('should warn if minor version is too high', async () => {
      await validateDb(mockProcess, mockConsole, mockPostgresWithVersion(140024));

      mockConsole.logged.should.deepEqual([
        'Testing database connection...',
        'Connection OK.',
        'Checking PostgreSQL version...',
        '',
        'Expected PostgreSQL v14.23 but found NEWER version: v14.24.',
        '',
      ]);

      should(mockProcess.exitCode).be.undefined();
    });

    it('should warn if major version is too high', async () => {
      await validateDb(mockProcess, mockConsole, mockPostgresWithVersion(150012));

      mockConsole.logged.should.deepEqual([
        'Testing database connection...',
        'Connection OK.',
        'Checking PostgreSQL version...',
        '',
        'Expected PostgreSQL v14.23 but found NEWER version: v15.12.',
        '',
      ]);

      should(mockProcess.exitCode).be.undefined();
    });

    it('should not warn if expected value is found', async () => {
      await validateDb(mockProcess, mockConsole, mockPostgresWithVersion(140023));

      mockConsole.logged.should.deepEqual([
        'Testing database connection...',
        'Connection OK.',
        'Checking PostgreSQL version...',
        'PostgreSQL version OK.',
        '',
      ]);

      should(mockProcess.exitCode).be.undefined();
    });
  });
});
