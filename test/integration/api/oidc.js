const { testService } = require('../setup');

describe('api: /oidc/...', () => {
  if (process.env.TEST_AUTH === 'oidc') {
    describe('GET /oidc/login', () => {
      it('should redirect to IdP if no parameters are provided', testService(service =>
        service.get('/v1/oidc/login')
          .expect(307)
          .then(({ text, headers }) => {
            const expectedUrlPrefix = 'http://localhost:9898/auth?client_id=odk-central-backend-dev&scope=openid%20email&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A8989%2Fv1%2Foidc%2Fcallback&resource=http%3A%2F%2Flocalhost%3A8989%2Fv1&code_challenge=';
            text.should.startWith('Temporary Redirect. Redirecting to ' + expectedUrlPrefix);
            headers.location.should.startWith(expectedUrlPrefix);
          })));
    });

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
    describe('GET /oidc/login', () => {
      it('should not exist', testService(service =>
        service.get('/v1/oidc/login')
          .expect(404)));
    });

    describe('GET /oidc/callback', () => {
      it('should not exist', testService(service =>
        service.get('/v1/oidc/callback')
          .expect(404)));
    });
  }
});
