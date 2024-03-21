const should = require('should');
const { testService } = require('../setup');

describe('http-headers', () => {
  it('should not include x-powered-by header', testService(async (service) => {
    const { headers } = await service.get('/v1/users/current');
    should(headers['x-powered-by']).be.undefined();
  }));
});
