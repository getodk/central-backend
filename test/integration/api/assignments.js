const should = require('should');
const { testService } = require('../setup');

describe('api: /assignments', () => {
  describe('GET', () => {
    it('should prohibit anonymous users from listing assignments', testService((service) =>
      service.get('/v1/assignments').expect(403)));

    it('should prohibit unprivileged users from listing assignments', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/assignments').expect(403))));

    it('should return all sitewide assignments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/assignments')
          .expect(200)
          .then(({ body }) => Promise.all([
              asAlice.get('/v1/users/current').expect(200).then(({ body }) => body.id),
              asAlice.get('/v1/roles/admin').expect(200).then(({ body }) => body.id)
            ]).then(([ actorId, roleId ]) => {
              body.length.should.equal(1);
              body[0].should.eql({ actorId, roleId });
            })))));

    it('should return assignments in extended metadata format if requested', testService((service) =>
      service.login('alice', (asAlice) => Promise.all([
          asAlice.get('/v1/assignments').set('X-Extended-Metadata', true).expect(200).then(({ body }) => body),
          asAlice.get('/v1/roles/admin').expect(200).then(({ body }) => body.id)
      ]).then(([ assignments, adminRoleId ]) => {
        assignments.length.should.equal(1);
        Object.keys(assignments[0]).should.eql([ 'actor', 'roleId' ]);
        assignments[0].actor.displayName.should.equal('Alice');
        assignments[0].roleId.should.equal(adminRoleId);
      }))));
  });

  describe('/:roleId GET', () => {
    it('should prohibit anonymous users from listing assignments', testService((service) =>
      service.get('/v1/assignments/admin').expect(403)));

    it('should prohibit unprivileged users from listing assignments', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/assignments/admin').expect(403))));

    it('should notfound by system id', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/assignments/blahblah').expect(404))));

    it('should return all assigned actors by system id', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/assignments/admin')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].should.be.an.Actor();
            body[0].displayName.should.equal('Alice');
          }))));

    it('should notfound by numeric id', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/assignments/999').expect(404))));

    it('should return all assigned actors by numeric id', testService((service) =>
      service.login('alice', (asAlice) => Promise.all([
          asAlice.get('/v1/assignments/admin').expect(200).then(({ body }) => body),
          asAlice.get('/v1/roles/admin').expect(200).then(({ body }) => body.id )
        ]).then(([ actors, adminRoleId ]) => {
          actors.length.should.equal(1);
          actors[0].should.be.an.Actor();
          actors[0].displayName.should.equal('Alice');
        }))));
  });
});

