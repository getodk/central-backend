const { testService } = require('../setup');

describe('api: user-preferences', () => {

  it('validates the request body stringently', testService(async (service) => {
    const asAlice = await service.login('alice');

    await asAlice.put('/v1/user-preferences/site/someProperty')
      .send({ notPropertyValue: 100 })
      .expect(400)
      .then(({ body }) => {
        body.code.should.eql(400.23);
        body.details.property.should.eql('propertyValue');
      });

    await asAlice.put('/v1/user-preferences/project/1/someProperty')
      .send({ spuriousProperty: 'ouch', propertyValue: 100, pancakes: true })
      .expect(400)
      .then(({ body }) => {
        body.code.should.eql(400.33);
        body.details.expected.should.eql(['propertyValue']);
        body.details.actual.should.eql(['spuriousProperty', 'propertyValue', 'pancakes']);
      });
  }));

  it('can store the string "null", distinct from NULL value', testService(async (service) => {
    const asAlice = await service.login('alice');

    await asAlice.put('/v1/user-preferences/site/let-us-store-a-string-whose-content-is-null')
      .send({ propertyValue: 'null' })
      .expect(200);

    await asAlice.get('/v1/users/current')
      .set('X-Extended-Metadata', 'true')
      .expect(200)
      .then(({ body }) => {
        body.preferences.should.eql({
          site: {
            'let-us-store-a-string-whose-content-is-null': 'null',
          },
          projects: {
          },
        });
      });
  }));

  it('can store a JS null propertyValue', testService(async (service) => {
    const asAlice = await service.login('alice');

    await asAlice.put('/v1/user-preferences/site/let-us-store-a-null')
      .send({ propertyValue: null })
      .expect(200);

    await asAlice.get('/v1/users/current')
      .set('X-Extended-Metadata', 'true')
      .expect(200)
      .then(({ body }) => {
        body.preferences.should.eql({
          site: {
            'let-us-store-a-null': null,
          },
          projects: {
          },
        });
      });
  }));

  it('should not allow storing preferences for nonexistent projects', testService(async (service) => {
    const asAlice = await service.login('alice');

    await asAlice.put('/v1/user-preferences/project/123/someProperty')
      .send({ propertyValue: 'someValue' })
      .expect(400); // project 123 doesn't exist
  }));

  it('PUT/DELETE preference storage operations', testService(async (service) => {
    const asAlice = await service.login('alice');

    // Storage of simple property value
    await asAlice.put('/v1/user-preferences/site/someSimpleSitePref')
      .send({ propertyValue: true })
      .expect(200);

    // Storage of property with complex value
    await asAlice.put('/v1/user-preferences/site/someComplexSitePref')
      .send({ propertyValue: { 1: 2, 3: 4 } })
      .expect(200);

    // Overwriting should work; later we'll check whether we retrieve this value
    await asAlice.put('/v1/user-preferences/site/someComplexSitePref')
      .send({ propertyValue: [1, 2, 3] })
      .expect(200);

    // Store some pref to delete later on
    await asAlice.put('/v1/user-preferences/site/toBeDeletedPref')
      .send({ propertyValue: 'troep' })
      .expect(200);

    // Store a *project* property (simple value)
    await asAlice.put('/v1/user-preferences/project/1/someSimpleProjectPref')
      .send({ propertyValue: false })
      .expect(200);

    // Store a *project* property (complex value)
    await asAlice.put('/v1/user-preferences/project/1/someComplexProjectPref')
      .send({ propertyValue: [1, 2, 'many'] })
      .expect(200);

    // make a new project and read its ID
    let newProjectID = null;
    await asAlice.post('/v1/projects')
      .send({ name: 'preferences test project' })
      .expect(200)
      .then(({ body }) => {
        newProjectID = body.id;
      });

    // we should be able to store a preference for the new project
    await asAlice.put(`/v1/user-preferences/project/${newProjectID}/prefForSomeOtherProject`)
      .send({ propertyValue: 9000 })
      .expect(200);

    // store a project preference on this new project to be deleted later on
    await asAlice.put(`/v1/user-preferences/project/${newProjectID}/toBeDeletedPref`)
      .send({ propertyValue: 'troep' })
      .expect(200);

    // insert a preference for Bob, which we don't want to find in the
    // preferences for Alice that we will subsequently fetch.
    await service.login('bob').then((asBob) =>
      asBob.put('/v1/user-preferences/site/koosje-likes-milk')
        .send({ propertyValue: true })
        .expect(200)
    );

    // check whether the built-up state is sane (eg stores and overwrites applied)
    await asAlice.get('/v1/users/current')
      .set('X-Extended-Metadata', 'true')
      .expect(200)
      .then(({ body }) => {
        body.preferences.should.eql({
          site: {
            someSimpleSitePref: true,
            someComplexSitePref: [1, 2, 3],
            toBeDeletedPref: 'troep',
          },
          projects: {
            1: {
              someSimpleProjectPref: false,
              someComplexProjectPref: [1, 2, 'many'],
            },
            [newProjectID]: {
              prefForSomeOtherProject: 9000,
              toBeDeletedPref: 'troep',
            },
          },
        });
      });

    // check deletion of a site preference
    await asAlice.delete('/v1/user-preferences/site/toBeDeletedPref')
      .expect(200);

    // check deletion of a project preference
    await asAlice.delete(`/v1/user-preferences/project/${newProjectID}/toBeDeletedPref`)
      .expect(200);

    // check whether deleting something nonexistent results in an informative error response
    await asAlice.delete(`/v1/user-preferences/project/${newProjectID}/toBeDeletedPref`)
      .expect(404); // as we've just deleted it

    // check whether the built-up state is sane (deletions applied)
    await asAlice.get('/v1/users/current')
      .expect(200)
      .set('X-Extended-Metadata', 'true')
      .then(({ body }) => {
        body.preferences.should.eql({
          site: {
            someSimpleSitePref: true,
            someComplexSitePref: [1, 2, 3],
          },
          projects: {
            1: {
              someSimpleProjectPref: false,
              someComplexProjectPref: [1, 2, 'many'],
            },
            [newProjectID]: {
              prefForSomeOtherProject: 9000,
            },
          },
        });
      });
  }));

  describe('audit log', () => {
    it('can log audit events for updating and deleting site property', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      const { Users } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();

      await asAlice.put('/v1/user-preferences/site/some-preference')
        .send({ propertyValue: 'some-value' })
        .expect(200);

      await asAlice.delete('/v1/user-preferences/site/some-preference')
        .expect(200);

      await asAlice.get('/v1/audits')
        .expect(200)
        .then(({ body }) => {
          body[0].action.should.equal('user.preference.delete');
          body[0].actorId.should.equal(5);
          body[0].acteeId.should.equal(alice.actor.acteeId);
          body[0].details.should.eql({ site: 'some-preference' });

          body[1].action.should.equal('user.preference.update');
          body[1].actorId.should.equal(5);
          body[1].acteeId.should.equal(alice.actor.acteeId);
          body[1].details.should.eql({ site: 'some-preference' });
        });
    }));

    it('can log audit events for updating and deleting project property', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      const { Users } = container;
      const alice = (await Users.getByEmail('alice@getodk.org')).get();

      await asAlice.put('/v1/user-preferences/project/1/some-preference')
        .send({ propertyValue: 'some-value' })
        .expect(200);

      await asAlice.delete('/v1/user-preferences/project/1/some-preference')
        .expect(200);

      await asAlice.get('/v1/audits')
        .expect(200)
        .then(({ body }) => {
          body[0].action.should.equal('user.preference.delete');
          body[0].actorId.should.equal(5);
          body[0].acteeId.should.equal(alice.actor.acteeId);
          body[0].details.should.eql({ project: 'some-preference' });

          body[1].action.should.equal('user.preference.update');
          body[1].actorId.should.equal(5);
          body[1].acteeId.should.equal(alice.actor.acteeId);
          body[1].details.should.eql({ project: 'some-preference' });
        });
    }));
  });
});
