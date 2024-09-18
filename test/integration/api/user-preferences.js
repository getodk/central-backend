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

    await asAlice.put('/v1/user-preferences/site/someSimpleSitePref')
      .send({ propertyValue: true })
      .expect(200);

    await asAlice.put('/v1/user-preferences/site/someComplexSitePref')
      .send({ propertyValue: { 1: 2, 3: 4 } })
      .expect(200);

    // overwrite the previous
    await asAlice.put('/v1/user-preferences/site/someComplexSitePref')
      .send({ propertyValue: [1, 2, 3] })
      .expect(200);

    await asAlice.put('/v1/user-preferences/site/toBeDeletedPref')
      .send({ propertyValue: 'troep' })
      .expect(200);

    await asAlice.put('/v1/user-preferences/project/1/someSimpleProjectPref')
      .send({ propertyValue: false })
      .expect(200);

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

    await asAlice.put(`/v1/user-preferences/project/${newProjectID}/prefForSomeOtherProject`)
      .send({ propertyValue: 9000 })
      .expect(200);

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

    const newProjectProps = {};
    newProjectProps[newProjectID] = {
      prefForSomeOtherProject: 9000,
      toBeDeletedPref: 'troep',
    };

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
          projects: Object.assign(
            {
              1: {
                someSimpleProjectPref: false,
                someComplexProjectPref: [1, 2, 'many'],
              },
            },
            newProjectProps,
          ),
        });
      });

    await asAlice.delete('/v1/user-preferences/site/toBeDeletedPref')
      .send({ propertyValue: true })
      .expect(200);

    await asAlice.delete(`/v1/user-preferences/project/${newProjectID}/toBeDeletedPref`)
      .send({ propertyValue: true })
      .expect(200);

    await asAlice.delete(`/v1/user-preferences/project/${newProjectID}/toBeDeletedPref`)
      .send({ propertyValue: true })
      .expect(404); // as we've just deleted it

    delete newProjectProps[newProjectID].toBeDeletedPref;

    await asAlice.get('/v1/users/current')
      .expect(200)
      .set('X-Extended-Metadata', 'true')
      .then(({ body }) => {
        body.preferences.should.eql({
          site: {
            someSimpleSitePref: true,
            someComplexSitePref: [1, 2, 3],
          },
          projects: Object.assign(
            {
              1: {
                someSimpleProjectPref: false,
                someComplexProjectPref: [1, 2, 'many'],
              },
            },
            newProjectProps
          ),
        });
      });
  }));
});
