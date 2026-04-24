const { testService } = require('../setup');

describe('http', () => {
  it('should return 404 for path URL decode errors', testService(async (service) => {
    const { body } = await service.get('/v1/%')
      .expect(404);

    body.should.deepEqual({
      code: 404.1,
      message: 'Could not find the resource you were looking for.',
    });
  }));

  describe('case-sensitive routing', () => {
    it(`should route to /v1/users/current`, testService(async (service) => {
      const { status } = await service.get('/v1/users/current');
      status.should.eql(401);
    }));

    it(`should NOT route to /v1/USERS/current`, testService(async (service) => {
      const { status } = await service.get('/v1/USERS/current');
      status.should.eql(404);
    }));
  });
});
