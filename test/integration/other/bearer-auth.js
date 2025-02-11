const { testService } = require('../setup');

describe('bearer authentication', () => {
  it('should reject 401 if supplied token does not match the expected format', testService((service) => // gh329
    service.get('/v1/users/current')
      .set('Authorization', 'Bearer a')
      .expect(401)));

  it('should reject 401 if the header format is wrong', testService((service) => // gh329
    service.get('/v1/users/current')
      .set('Authorization', 'Bearer: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      .expect(401)));
});

