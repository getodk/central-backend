const should = require('should');
const { pipe } = require('ramda');
const { DateTime } = require('luxon');
const { testService } = require('../setup');
const testData = require('../data');

describe('api: /field-keys', () => {
  describe('POST', () => {
    it('should return 403 unless the user is allowed to create', testService((service) =>
      service.post('/v1/field-keys')
        .send({ displayName: 'test1' })
        .expect(403)));

    it('should return the created key', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/field-keys')
          .send({ displayName: 'test1' })
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.FieldKey();
            body.displayName.should.equal('test1');
            body.createdBy.should.equal(5);
          }))));
  });

  describe('GET', () => {
    it('should return 403 unless the user is allowed to list', testService((service) =>
      service.get('/v1/field-keys').expect(403)));

    it('should return a list of tokens in order with merged data', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/field-keys').send({ displayName: 'test 1' }).expect(200)
          .then(() => asAlice.post('/v1/field-keys').send({ displayName: 'test 2' }).expect(200))
          .then(() => asAlice.post('/v1/field-keys').send({ displayName: 'test 3' }).expect(200))
          .then(() => asAlice.get('/v1/field-keys')
            .expect(200)
            .then(({ body }) => {
              body.map((fk) => fk.displayName).should.eql([ 'test 3', 'test 2', 'test 1' ]);
              body.forEach((fk) => {
                fk.should.be.a.FieldKey()
                fk.createdBy.should.equal(5);
              });
            })))));

    it('should leave tokens out if the session is ended', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/field-keys').send({ displayName: 'compromised' }).expect(200)
          .then(({ body }) => asAlice.delete('/v1/sessions/' + body.token).expect(200))
          .then(() => asAlice.get('/v1/field-keys')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              const [ key ] = body;
              key.should.be.a.FieldKey();
              should(key.token).equal(null);
            })))));

    it('should join through additional data if extended metadata is requested', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/field-keys').send({ displayName: 'test 1' }).expect(200)
          .then(() => asAlice.post('/v1/field-keys').send({ displayName: 'test 2' }).expect(200))
          .then(() => asAlice.get('/v1/field-keys')
            .set('X-Extended-Metadata', 'true')
            .expect(200)
            .then(({ body }) => body.forEach((obj) => {
              obj.should.be.an.ExtendedFieldKey();
              obj.createdBy.displayName.should.equal('Alice');
            }))))));

    it('should correctly report last used in extended metadata', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/field-keys').send({ displayName: 'test 1' }).expect(200)
          .then(() => asAlice.post('/v1/field-keys').send({ displayName: 'test 2' })
            .then(({ body }) => service.post(`/v1/key/${body.token}/forms/simple/submissions`)
              .send(testData.instances.simple.one)
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() => asAlice.get('/v1/field-keys')
                .set('X-Extended-Metadata', 'true')
                .expect(200)
                .then(({ body }) => {
                  body.forEach((fk) => fk.should.be.an.ExtendedFieldKey());
                  body[0].lastUsed.should.be.a.recentIsoDate();
                  should(body[1].lastUsed).equal(null);
                })))))));
  });

  describe('/:id DELETE', () => {
    it('should return 403 unless the user can delete', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/field-keys').send({ displayName: 'condemned' }).expect(200)
          .then(({ body }) =>
            service.delete('/v1/field-keys/' + body.id).expect(403)))));

    it('should delete the token', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/field-keys').send({ displayName: 'condemned' }).expect(200)
          .then(({ body }) => asAlice.delete('/v1/field-keys/' + body.id).expect(200))
          .then(() => asAlice.get('/v1/field-keys')
            .expect(200)
            .then(({ body }) => body.should.eql([]))))));
  });
});


// Test the actual use of field keys.
// TODO: perhaps these deserve their own file.
describe('api: /key/:key', () => {
  it('should return 401 if an invalid key is provided', testService((service) =>
    service.get('/v1/key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/users/current')
      .expect(401)));

  it('should return 401 if two credentials are presented', testService((service) =>
    service.login('alice', (asAlice) => asAlice.post('/v1/field-keys').send({ displayName: 'fktest' })
      .then(({ body }) => asAlice.post(`/v1/key/${body.token}/users/current`)
        .expect(401)))));

  it('should reject non-field tokens', testService((service) =>
    service.post('/v1/sessions').send({ email: 'alice@opendatakit.org', password: 'alice' })
      .then(({ body }) => service.get(`/v1/key/${body.token}/users/current`)
        .expect(401))));

  it('should passthrough to the appropriate route with successful auth', testService((service) =>
    service.login('alice', (asAlice) => asAlice.post('/v1/field-keys').send({ displayName: 'fktest' })
      .then(({ body }) => service.post(`/v1/key/${body.token}/forms/simple/submissions`)
        .send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml')
        .expect(200)))));
});

