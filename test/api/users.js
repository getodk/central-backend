const should = require('should');
const { testService, as } = require('./setup');
const { shouldBeDate, couldBeDate } = require('./util');

describe('api: /users', () => {
  describe('GET', () => {
    it('should prohibit anonymous users from listing users', testService((service) =>
      service.get('/v1/users').expect(403)));

    it('should return a list of sorted users', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/users')
          .expect(200)
          .expect(({ body }) => {
            body
              .map(shouldBeDate('createdAt'))
              .map(couldBeDate('updatedAt'))
              .should.eql([
                { displayName: 'Alice', email: 'alice@opendatakit.org', id: 4, meta: null },
                { displayName: 'Bob', email: 'bob@opendatakit.org', id: 5, meta: null },
                { displayName: 'Chelsea', email: 'chelsea@opendatakit.org', id: 6, meta: null }
              ]);
          }))));
  });
});

