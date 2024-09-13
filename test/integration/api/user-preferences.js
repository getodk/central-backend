const { testService } = require('../setup');

describe('api: user-preferences', () => {

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
      .expect(201);

    await asAlice.put('/v1/user-preferences/site/someComplexSitePref')
      .send({ propertyValue: { 1: 2, 3: 4 } })
      .expect(201);

    // overwrite the previous
    await asAlice.put('/v1/user-preferences/site/someComplexSitePref')
      .send({ propertyValue: [1, 2, 3] })
      .expect(201);

    await asAlice.put('/v1/user-preferences/site/toBeDeletedPref')
      .send({ propertyValue: 'troep' })
      .expect(201);

    await asAlice.put('/v1/user-preferences/project/1/someSimpleProjectPref')
      .send({ propertyValue: false })
      .expect(201);

    await asAlice.put('/v1/user-preferences/project/1/someComplexProjectPref')
      .send({ propertyValue: [1, 2, 'many'] })
      .expect(201);

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
      .expect(201);

    await asAlice.put(`/v1/user-preferences/project/${newProjectID}/toBeDeletedPref`)
      .send({ propertyValue: 'troep' })
      .expect(201);

    // insert a preference for Bob, which we don't want to find in the
    // preferences for Alice that we will subsequently fetch.
    await service.login('bob').then((asBob) =>
      asBob.put('/v1/user-preferences/site/koosje-likes-milk')
        .send({ propertyValue: true })
        .expect(201)
    );

    const newProjectProps = {};
    newProjectProps[newProjectID] = {
      prefForSomeOtherProject: 9000,
      toBeDeletedPref: 'troep',
    };

    await asAlice.get('/v1/user-preferences')
      .expect(200)
      .then(({ body }) => {
        body.should.eql({
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
      .expect(204);

    await asAlice.delete(`/v1/user-preferences/project/${newProjectID}/toBeDeletedPref`)
      .send({ propertyValue: true })
      .expect(204);

    await asAlice.delete(`/v1/user-preferences/project/${newProjectID}/toBeDeletedPref`)
      .send({ propertyValue: true })
      .expect(404); // as we've just deleted it

    delete newProjectProps[newProjectID].toBeDeletedPref;

    await asAlice.get('/v1/user-preferences')
      .expect(200)
      .then(({ body }) => {
        body.should.eql({
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
