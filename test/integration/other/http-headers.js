const should = require('should');
const { testService } = require('../setup');

describe('http-headers', () => {
  it('should not include x-powered-by header', testService(async (service) => {
    const { headers } = await service.get('/v1/users/current');
    should(headers['x-powered-by']).be.undefined();
  }));

  describe('caching headers', () => {
    ['head', 'get'].forEach(method => {
      it(`should allow private caching of ${method.toUpperCase()} responses`, testService(async (service) => {
        const { headers } = await service[method]('/v1/users/current');
        headers['cache-control'].should.eql('private, no-cache');
        headers['vary'].should.eql('Accept-Encoding, Authorization, Cookie, Origin'); // eslint-disable-line dot-notation
      }));
    });

    ['delete', 'patch', 'post', 'put'].forEach(method => {
      it(`should not allow any caching of ${method.toUpperCase()} responses`, testService(async (service) => {
        const { headers } = await service[method]('/v1/users/current');
        headers['cache-control'].should.eql('no-store');
        headers['vary'].should.eql('*'); // eslint-disable-line dot-notation
      }));
    });
  });
});
