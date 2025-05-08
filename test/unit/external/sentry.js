/* eslint-disable no-multi-spaces */

const { sanitizeArgv } = require('../../../lib/external/sentry');

describe('external/sentry', () => {
  describe('sanitizeArgv()', () => {
    [
      [
        [ '--mode', 'submissions' ],
        [ '--mode', 'submissions' ],
      ],
      [
        [ '--email', 'admin@example.test', 'user-create' ],
        [ '--email', '***@***',            'user-create' ],
      ],
      [
        [ '-u', 'admin@example.test', 'user-create' ],
        [ '-u', '***@***',            'user-create' ],
      ],
    ].forEach(([ argv, expectedOutput ], idx) => {
      it(`should sanitise sensitive inputs (example #${idx})`, () => {
        sanitizeArgv(argv).should.eql(expectedOutput);
      });
    });
  });
});
