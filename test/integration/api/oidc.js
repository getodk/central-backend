const { testService } = require('../setup');

describe('api: /oidc/...', () => {
  if (process.env.TEST_AUTH === 'oidc') {
    describe('GET /oidc/callback', () => {
      it('should redirect to error page if no parameters are provided', testService(service =>
        service.get('/v1/oidc/callback')
          .expect(303)
          .then(({ text, headers }) => {
            text.should.eql('See Other. Redirecting to http://localhost:8989/#/login?oidcError=internal-server-error');
            headers.location.should.eql('http://localhost:8989/#/login?oidcError=internal-server-error');
          })));
    });
  } else { // OIDC not enabled
    describe('GET /oidc/callback', () => {
      it('should not exist', testService(service =>
        service.get('/v1/oidc/callback')
          .expect(404)));
    });
  }
});
