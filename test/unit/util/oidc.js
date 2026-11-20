const { isEmailVerified } = require('../../../lib/util/oidc');

describe('util/oidc', () => {
  describe('isEmailVerified()', () => {
    [
      true,
      'true',
    ].forEach(email_verified => { // eslint-disable-line camelcase
      it(`should evaluate ${JSON.stringify(email_verified)} as true`, () => {
        isEmailVerified({ email_verified }).should.be.true();
      });
    });

    [
      null,
      undefined,
      true,
      {},
    ].forEach(userinfo => {
      it(`should evaluate userinfo '${JSON.stringify(userinfo)}' as false`, () => {
        isEmailVerified(userinfo).should.be.false();
      });
    });

    [
      false,
      null,
      undefined,
      0,
      1,
      { value: true },
      'false',
      'TRUE',
    ].forEach(email_verified => { // eslint-disable-line camelcase
      it(`should evaluate ${JSON.stringify(email_verified)} as false`, () => {
        isEmailVerified({ email_verified }).should.be.false();
      });
    });
  });
});
