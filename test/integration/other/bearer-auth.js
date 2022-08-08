const { testService } = require('../setup');

describe('bearer authentication', () => {
  it('should reject 401 if the key format is wrong', testService((service) => // gh329
    service.get('/v1/users/current')
      .set('Authorization', 'Bearer: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      .expect(401)));
});

