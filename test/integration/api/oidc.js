const { testService } = require('../setup');

describe('api: /oidc/...', () => {
  if (process.env.TEST_AUTH === 'oidc') {
    describe('GET /oidc/login', () => {
      it('should redirect to IdP if no parameters are provided', testService(service =>
        service.get('/v1/oidc/login')
          .expect(307)
          .then(({ text, headers }) => {
            const expectedUrlPrefix = 'http://localhost:9898/auth?';
            text.should.startWith('Temporary Redirect. Redirecting to ' + expectedUrlPrefix);
            headers.location.should.startWith(expectedUrlPrefix);

            const url = new URL(headers.location);
            url.searchParams.sort();

            [ ...url.searchParams.keys() ].should.eql([
              'client_id',
              'code_challenge',
              'code_challenge_method',
              'redirect_uri',
              'resource',
              'response_type',
              'scope',
              'state',
            ]);

            url.searchParams.get('client_id').should.eql('odk-central-backend-dev');
            url.searchParams.get('code_challenge_method').should.eql('S256');
            url.searchParams.get('redirect_uri').should.eql('http://localhost:8989/v1/oidc/callback');
            url.searchParams.get('resource').should.eql('http://localhost:8989/v1');
            url.searchParams.get('response_type').should.eql('code');
            url.searchParams.get('scope').should.eql('openid email');

            url.searchParams.get('code_challenge').should.match(/^[a-zA-Z0-9-_]{43}$/);
            url.searchParams.get('state'         ).should.match(/^[a-zA-Z0-9-_]{43}:$/); // eslint-disable-line space-in-parens,no-multi-spaces
          })));

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

      it('should not exist', testService(service =>
        service.get('/v1/oidc/callback')
          .expect(404)));
    });
  }
});
