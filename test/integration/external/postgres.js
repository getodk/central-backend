const { testContainer } = require('../setup');

const { validateDb } = require('../../../lib/external/postgres');

describe('external/postgres', () => {
  describe('validateDb()', () => {
    it('should succeed with expected logging for correctly-configured db', testContainer(async ({ oneFirst }) => {
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
          timestamp.should.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
          prefix.should.eql('[central-backend|validateDb]');
          this.logged.push(message.join(' '));
        },
      };

      // when
      await validateDb(mockProcess, mockConsole, { oneFirst });

      // then
      mockConsole.logged.should.deepEqual([
        'Testing database connection...',
        'Connection OK.',
        'Checking PostgreSQL version...',
        'PostgreSQL version OK.',
      ]);
    }));
  });
});
