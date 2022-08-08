const { testService } = require('../setup');

describe('basic authentication', () => {
  it('should accept email and password', testService((service) =>
    service.get('/v1/users/current')
      .set('x-forwarded-proto', 'https')
      .auth('alice@getodk.org', 'alice')
      .expect(200)));
});

