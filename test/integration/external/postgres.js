const { testContainer } = require('../setup');

const { validateDb } = require('../../../lib/external/postgres');

describe('external/postgres', () => {
  describe('validateDb()', () => {
    it('should succeed with expected logging for correctly-configured db', testContainer(async ({ db }) => {
      // given
      const mockProcess = {
        exit(statusCode) {
          if (statusCode === 0) return;
          throw new Error(`process.exit() called with non-zero status code: '${statusCode}'`);
        }
      };

      const mockConsole = {
        logged: [],
        error(timestamp, prefix, ...message) {
          console.log(timestamp, prefix, ...message); // eslint-disable-line no-console
          timestamp.should.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
          prefix.should.eql('[central-backend|validateDb]');
          this.logged.push(message.join(' '));
        },
      };

      // when
      await validateDb(mockProcess, mockConsole, db);

      // then
      mockConsole.logged.should.deepEqual([
        'Testing database connection...',
        'Connection OK.',
        'Checking PostgreSQL version...',
        'PostgreSQL version OK.',
        'Checking PostgreSQL extensions...',
        'All expected extensions were found; checking version numbers...',
        'PostgreSQL extensions look OK.',

      ]);
    }));
  });
});
