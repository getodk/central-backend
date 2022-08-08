const { testService } = require('../setup');

describe('api: /roles', () => {
  describe('GET', () => {
    it('should return all roles', testService((service) =>
      service.get('/v1/roles')
        .expect(200)
        .then(({ body }) => {
          // trying not to make these assertions too specific so the test
          // doesn't have to change every time the baseline changes.
          body.length.should.be.greaterThan(3);
          body.forEach((role) => role.should.be.a.Role());
          body.map((role) => role.system).includes('admin').should.equal(true);
        })));
  });

  describe('/:id GET', () => {
    it('should notfound a role by system id', testService((service) =>
      service.get('/v1/roles/aoeu').expect(404)));

    it('should retrieve a role by system id', testService((service) =>
      service.get('/v1/roles/admin')
        .expect(200)
        .then(({ body }) => {
          body.should.be.a.Role();
          body.name.should.equal('Administrator');
          body.system.should.equal('admin');
          body.verbs.length.should.be.greaterThan(10); // again, not too specific.
        })));

    it('should notfound a role by numeric id', testService((service) =>
      service.get('/v1/roles/999').expect(404)));

    it('should retrive a role by numeric id', testService((service) =>
      service.get('/v1/roles/admin').expect(200).then(({ body }) => body.id)
        .then((adminRoleId) => service.get('/v1/roles/' + adminRoleId)
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Role();
            body.name.should.equal('Administrator');
            body.system.should.equal('admin');
          }))));
  });
});

