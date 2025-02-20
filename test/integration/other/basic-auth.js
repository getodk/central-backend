const { testService } = require('../setup');

describe('basic authentication', () => {
  if (process.env.TEST_AUTH === 'oidc') {
    it('should not accept email and password', testService((service) =>
      service.get('/v1/users/current')
        .set('x-forwarded-proto', 'https')
        .auth('alice@getodk.org', 'password4alice')
        .expect(401)));
  } else {
    it('should accept email and password', testService((service) =>
      service.get('/v1/users/current')
        .set('x-forwarded-proto', 'https')
        .auth('alice@getodk.org', 'password4alice')
        .expect(200)));
  }
});

