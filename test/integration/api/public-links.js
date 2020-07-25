const should = require('should');
const { pipe } = require('ramda');
const { DateTime } = require('luxon');
const { testService } = require('../setup');
const testData = require('../../data/xml');

describe('api: /projects/:id/forms/:id/public-links', () => {
  describe('POST', () => {
    it('should return 403 unless the user is allowed to create', testService((service) =>
      service.post('/v1/projects/1/forms/simple/public-links')
        .send({ displayName: 'test1' })
        .expect(403)));

    it('should return the created key', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/public-links')
          .send({ displayName: 'test1' })
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.PublicLink();
            body.displayName.should.equal('test1');
            body.createdBy.should.equal(5);
          }))));

    it('should allow project managers to create', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.post('/v1/projects/1/forms/simple/public-links')
          .send({ displayName: 'test1' })
          .expect(200))));

    it('should allow the created user to submit to the given form', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/public-links')
          .send({ displayName: 'test1' })
          .expect(200)
          .then(({ body }) => body.token)
          .then((key) => service.post(`/v1/key/${key}/projects/1/forms/simple/submissions`)
            .set('Content-Type', 'text/xml')
            .send(testData.instances.simple.one)
            .expect(200)))));
  });

  describe('GET', () => {
    it('should return 403 unless the user is allowed to list', testService((service) =>
      service.get('/v1/projects/1/forms/simple/public-links').expect(403)));

    it('should return a list of links in order with merged data', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/public-links').send({ displayName: 'test 1' }).expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/public-links').send({ displayName: 'test 2' }).expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/public-links').send({ displayName: 'test 3' }).expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/public-links')
            .expect(200)
            .then(({ body }) => {
              body.map((link) => link.displayName).should.eql([ 'test 3', 'test 2', 'test 1' ]);
              body.forEach((link) => {
                link.should.be.a.PublicLink()
                link.createdBy.should.equal(5);
                link.formId.should.equal(1);
              });
            })))));

    it('should only return tokens from the requested form', testService((service) =>
      service.login('alice', (asAlice) => Promise.all([
        asAlice.post('/v1/projects/1/forms/simple/public-links').send({ displayName: 'test 1' }).expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/public-links').send({ displayName: 'test 2' }).expect(200)),
        asAlice.post(`/v1/projects/1/forms/withrepeat/public-links`).send({ displayName: 'test 3' }).expect(200)
      ])
        .then(() => asAlice.get('/v1/projects/1/forms/simple/public-links')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(2);
            body[0].displayName.should.equal('test 2');
            body[1].displayName.should.equal('test 1');
          })))));

    it('should leave tokens out if the session is ended', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/public-links').send({ displayName: 'compromised' }).expect(200)
          .then(({ body }) => asAlice.delete('/v1/sessions/' + body.token).expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/public-links')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              const [ key ] = body;
              key.should.be.a.PublicLink();
              should(key.token).equal(null);
            })))));

    it('should sort revoked links to the bottom', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/public-links').send({ displayName: 'test 1' }).expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/public-links').send({ displayName: 'test 2' }).expect(200))
          .then(({ body }) => asAlice.delete('/v1/sessions/' + body.token).expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/public-links').send({ displayName: 'test 3' }).expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/public-links')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(3);
              body.forEach((key) => key.should.be.a.PublicLink());
              body.map((key) => key.displayName).should.eql([ 'test 3', 'test 1', 'test 2' ]);
            })))));

    it('should join through additional data if extended metadata is requested', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/public-links').send({ displayName: 'test 1' }).expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/public-links').send({ displayName: 'test 2' }).expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/public-links')
            .set('X-Extended-Metadata', 'true')
            .expect(200)
            .then(({ body }) => body.forEach((obj) => {
              obj.should.be.an.ExtendedPublicLink();
              obj.createdBy.displayName.should.equal('Alice');
              obj.formId.should.equal(1);
            }))))));

    it('should sort revoked field keys to the bottom in extended metadata', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/public-links').send({ displayName: 'test 1' }).expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/public-links').send({ displayName: 'test 2' }).expect(200))
          .then(({ body }) => asAlice.delete('/v1/sessions/' + body.token).expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/public-links').send({ displayName: 'test 3' }).expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/public-links')
            .set('X-Extended-Metadata', true)
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(3);
              body.forEach((key) => key.should.be.a.PublicLink());
              body.map((key) => key.displayName).should.eql([ 'test 3', 'test 1', 'test 2' ]);
            })))));
  });

  describe('/:id DELETE', () => {
    it('should return 403 unless the user can delete', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/public-links').send({ displayName: 'condemned' }).expect(200)
          .then(({ body }) =>
            service.delete('/v1/projects/1/forms/simple/public-links/' + body.id).expect(403)))));

    it('should delete the token', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/public-links').send({ displayName: 'condemned' }).expect(200)
          .then(({ body }) => asAlice.delete('/v1/projects/1/forms/simple/public-links/' + body.id).expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/public-links')
            .expect(200)
            .then(({ body }) => body.should.eql([]))))));

    it('should allow project managers to delete', testService((service) =>
      service.login('bob', (asBob) =>
        asBob.post('/v1/projects/1/forms/simple/public-links').send({ displayName: 'condemned' }).expect(200)
          .then(({ body }) => asBob.delete('/v1/projects/1/forms/simple/public-links/' + body.id).expect(200)))));

    it('should only delete the token if it is part of the form', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/withrepeat/public-links')
          .send({ displayName: 'condemned' })
          .expect(200)
          .then(({ body }) => asAlice.delete(`/v1/projects/1/forms/simple/public-links/${body.id}`)
            .expect(404)))));
  });
});


// Test the actual use of public links.
describe('api: /key/:key', () => {
  it('should return 401 if an invalid key is provided', testService((service) =>
    service.get('/v1/key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/users/current')
      .expect(401)));

  it('should return 401 if two credentials are presented', testService((service) =>
    service.login('alice', (asAlice) => asAlice.post('/v1/projects/1/forms/simple/public-links')
      .send({ displayName: 'linktest' })
      .then(({ body }) => asAlice.get(`/v1/key/${body.token}/users/current`)
        .expect(401)))));

  it('should passthrough to the appropriate route with successful auth', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms/simple/public-links')
        .send({ displayName: 'linktest' })
        .then(({ body }) => body)
        .then((link) => service.post(`/v1/key/${link.token}/projects/1/forms/simple/submissions`)
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)))));

  it('should not allow creating submissions on other forms', testService((service) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms/simple/public-links')
        .send({ displayName: 'linktest' })
        .then(({ body }) => body)
        .then((link) => service.post(`/v1/key/${link.token}/projects/1/forms/withrepeat/submissions`)
          .send(testData.instances.withrepeat.one)
          .set('Content-Type', 'application/xml')
          .expect(403)))));
});


