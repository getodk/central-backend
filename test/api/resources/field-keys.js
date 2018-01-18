const should = require('should');
const { pipe } = require('ramda');
const { testService } = require('../setup');
const { shouldBeDate, couldBeDate, shouldBeToken } = require('../util');

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
          .then(({ body }) =>
            // TODO: not happy about how these assertions are done.
            pipe(shouldBeToken('token'), shouldBeDate('createdAt'))(body)
              .should.eql({ id: 8, displayName: 'test1', createdBy: 5, meta: null, updatedAt: null })))));
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
            .then(({ body }) =>
              // TODO: not happy about how these assertions are done.
              body
                .map(shouldBeToken('token'))
                .map(shouldBeDate('createdAt'))
                .should.eql([
                  { id: 11, displayName: 'test 3', createdBy: 5, meta: null, updatedAt: null },
                  { id: 10, displayName: 'test 2', createdBy: 5, meta: null, updatedAt: null },
                  { id: 9, displayName: 'test 1', createdBy: 5, meta: null, updatedAt: null }
                ]))))));

    it('should leave tokens out if the session is ended', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/field-keys').send({ displayName: 'compromised' }).expect(200)
          .then(({ body }) => asAlice.delete('/v1/sessions/' + body.token).expect(200))
          .then(() => asAlice.get('/v1/field-keys')
            .expect(200)
            .then(({ body }) =>
              // TODO: not happy about how these assertions are done.
              body
                .map(shouldBeDate('createdAt'))
                .should.eql([ { id: 12, displayName: 'compromised', createdBy: 5, meta: null, updatedAt: null, token: null } ]))))));
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

