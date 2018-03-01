const should = require('should');
const util = require('../../../lib/util/crypto');

describe('util/crypto', () => {
  describe('hashPassword/verifyPassword', () => {
    const { hashPassword, verifyPassword } = util;
    // we do not actually verify the hashing itself, as:
    // 1. it is entirely performed by bcrypt, which has is own tests.
    // 2. bcrypt is intentionally slow, and we would like unit tests to be fast.

    it('should always return an ExplicitPromise', () => {
      hashPassword('').isExplicitPromise.should.equal(true);
      hashPassword('password').isExplicitPromise.should.equal(true);
      verifyPassword('password', 'hashhash').isExplicitPromise.should.equal(true);
    });

    it('should return an ExplicitPromise of null given a blank plaintext', (done) => {
      hashPassword('').point().then((result) => {
        should(result).equal(null);
        done();
      });
    });

    it('should not attempt to verify empty plaintext', (done) => {
      verifyPassword('', '$2a$12$hCRUXz/7Hx2iKPLCduvrWugC5Q/j5e3bX9KvaYvaIvg/uvFYEpzSy').point().then((result) => {
        result.should.equal(false);
        done();
      });
    });

    it('should not attempt to verify empty hash', (done) => {
      verifyPassword('password', '').point().then((result) => {
        result.should.equal(false);
        done();
      });
    });
  });
});

