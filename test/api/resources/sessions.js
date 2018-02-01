const should = require('should');
const { testService } = require('../setup');

describe('api: /sessions', () => {
  describe('POST', () => {
    it('should return a new session if the information is valid', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'chelsea@opendatakit.org', password: 'chelsea' })
        .expect(200)
        .then(({ body }) => {
          body.should.be.a.Session();
        })));

    it('should return a 401 if the password is wrong', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'chelsea@opendatakit.org', password: 'letmein' })
        .expect(401)
        .then(({ body }) => body.message.should.equal('Could not authenticate with the provided credentials.'))));

    it('should return a 401 if the email is wrong', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'winnifred@opendatakit.org', password: 'winnifred' })
        .expect(401)
        .then(({ body }) => body.message.should.equal('Could not authenticate with the provided credentials.'))));

    it('should return a 400 if insufficient information is provided', testService((service) =>
      service.post('/v1/sessions')
        .expect(400)
        .then(({ body }) => body.details.should.eql({ expected: [ 'email', 'password' ], got: {} }))));
  });

  describe('/:token DELETE', () => {
    it('should return a 403 if the token does not exist', testService((service) =>
      service.delete('/v1/sessions/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
        .expect(403)));

    it('should return a 403 if the user cannot delete the given token', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'alice@opendatakit.org', password: 'alice' })
        .expect(200)
        .then(({ body }) => {
          const token = body.token;
          return service.login('chelsea', (asChelsea) =>
            asChelsea.delete('/v1/sessions/' + token).expect(403));
        })));

    it('should invalidate the token if successful', testService((service) =>
      service.post('/v1/sessions')
        .send({ email: 'alice@opendatakit.org', password: 'alice' })
        .expect(200)
        .then(({ body }) => {
          const token = body.token;
          return service.delete('/v1/sessions/' + token)
            .set('Authorization', 'Bearer ' + token)
            .expect(200)
            .then(() => service.get('/v1/users/current') // actually doesn't matter which route; we get 401 due to broken auth.
              .set('Authorization', 'Bearer ' + token)
              .expect(401));
        })));
  });
});

