const { testService } = require('../setup');

describe('bodyParser', () => {
  it('should return a reasonable error on unparseable requests', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects')
        .set('Content-Type', 'application/json')
        .send('{"broken JSON":')
        .expect(400)
        .then(({ body }) => {
          body.code.should.equal(400.1);
          body.details.should.eql({ format: 'json', rawLength: 15 });
        }))));

  it('should return a formatted 404 on routematch failure', testService((service) =>
    service.get('/v1/nonexistent')
      .expect(404)
      .then(({ body }) => {
        body.code.should.equal(404.1);
      })));
});

