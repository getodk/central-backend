const { testContainer, testService } = require('../setup');

const { validateDb } = require('../../../lib/external/postgres');

describe('postgres', () => {
  describe('validateDb()', () => {
    it('should succeed with expected logging for correctly-configured db', testContainer(async ({ oneFirst }) => {
      // given
      const mockConsole = {
        logged: [],
        error(timestamp, prefix, ...message) {
          timestamp.should.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
          prefix.should.eql('[central-backend|validateDb]');
          this.logged.push(message.join(' '));
        },
      };

      // when
      await validateDb(mockConsole, { oneFirst });

      // then
      mockConsole.logged.should.deepEqual([
        'Testing database connection...',
        'Connection OK.',
        'Checking PostgreSQL version...',
        'WARN: Expected PostgreSQL v14.23 but found NEWER version: v18.6.  This may have unexpected effects.',
      ]);
    }));
  });
});
