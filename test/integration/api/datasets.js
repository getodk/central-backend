const { readFileSync } = require('fs');
const appRoot = require('app-root-path');
const { testService, testServiceFullTrx } = require('../setup');
const testData = require('../../data/xml');
const config = require('config');
const { Form } = require('../../../lib/model/frames');
const should = require('should');
const { sql } = require('slonik');
const { QueryOptions } = require('../../../lib/util/db');
const { createConflict } = require('../../util/scenarios');
const { omit, last } = require('ramda');
const xml2js = require('xml2js');

const { exhaust } = require(appRoot + '/lib/worker/worker');
const Option = require(appRoot + '/lib/util/option');
const { md5sum } = require(appRoot + '/lib/util/crypto');

const testEntities = (test) => testService(async (service, container) => {
  const asAlice = await service.login('alice');

  await asAlice.post(`/v1/projects/1/datasets`)
    .send({ name: 'people' });

  const uuids = [
    '12345678-1234-4123-8234-123456789aaa',
    '12345678-1234-4123-8234-123456789abc'
  ];

  uuids.forEach(async _uuid => {
    await asAlice.post('/v1/projects/1/datasets/people/entities')
      .send({
        uuid: _uuid,
        label: 'John Doe'
      })
      .expect(200);
  });

  await test(service, container);
});

describe('datasets and entities', () => {

  describe('creating datasets and properties via the API', () => {
    describe('projects/:id/datasets POST', () => {
      it('should reject if user cannot create datasets', testService(async (service) => {
        const asChelsea = await service.login('chelsea');

        await asChelsea.post('/v1/projects/1/datasets')
          .send({
            name: 'trees'
          })
          .expect(403);
      }));

      it('should reject if dataset name is not provided', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets')
          .send({})
          .expect(400)
          .then(({ body }) => {
            body.message.should.equal('Unexpected name value undefined; This is not a valid dataset name.');
          });
      }));

      it('should reject if dataset name is null', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets')
          .send({
            name: null
          })
          .expect(400)
          .then(({ body }) => {
            body.message.should.equal('Unexpected name value null; This is not a valid dataset name.');
          });
      }));

      it('should reject dataset name is invalid', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets')
          .send({
            name: '__not_allowed'
          })
          .expect(400)
          .then(({ body }) => {
            body.message.should.equal('Unexpected name value __not_allowed; This is not a valid dataset name.');
          });
      }));

      it('should create a new dataset and return dataset', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets')
          .send({
            name: 'trees'
          })
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Dataset();
            body.name.should.equal('trees');
            body.properties.should.eql([]);
            body.approvalRequired.should.eql(false);
            body.ownerOnly.should.eql(false);
          });
      }));

      it('should allow properties to be set on new dataset', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets')
          .send({
            name: 'trees',
            approvalRequired: true,
            ownerOnly: true
          })
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.Dataset();
            body.name.should.equal('trees');
            body.properties.should.eql([]);
            body.approvalRequired.should.eql(true);
            body.ownerOnly.should.eql(true);
          });
      }));

      describe('dataset name conflicts via API', () => {
        it('should reject if creating a dataset that already exists', testService(async (service) => {
          const asAlice = await service.login('alice');

          await asAlice.post('/v1/projects/1/datasets')
            .send({
              name: 'trees'
            })
            .expect(200);

          // Second time
          await asAlice.post('/v1/projects/1/datasets')
            .send({
              name: 'trees'
            })
            .expect(409)
            .then(({ body }) => {
              body.code.should.equal(409.3);
              body.message.should.equal('A resource already exists with name,projectId value(s) of trees,1.');
            });
        }));

        it('should reject if creating a dataset that has a similar name to an existing published dataset', testService(async (service) => {
          const asAlice = await service.login('alice');

          await asAlice.post('/v1/projects/1/datasets')
            .send({
              name: 'trees'
            })
            .expect(200);

          // Second time
          await asAlice.post('/v1/projects/1/datasets')
            .send({
              name: 'TREES'
            })
            .expect(409)
            .then(({ body }) => {
              body.code.should.equal(409.16);
              body.message.should.startWith("A dataset named 'trees' exists and you provided 'TREES'");
            });
        }));

        it('should allow creating a dataset that only exists as a draft', testService(async (service) => {
          const asAlice = await service.login('alice');

          // draft "people" dataset
          await asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/datasets')
            .send({
              name: 'people'
            })
            .expect(200);
        }));

        it('should allow creating a dataset that has a similar name to a draft dataset', testService(async (service) => {
          const asAlice = await service.login('alice');

          // draft "people" dataset
          await asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/datasets')
            .send({
              name: 'PEOPLE'
            })
            .expect(200);
        }));

        it('should not allow creating a dataset with same name as draft that conflicts with published dataset', testService(async (service) => {
          const asAlice = await service.login('alice');

          // draft "people" dataset
          await asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          // draft "PEOPLE" dataset
          await asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity
              .replace('dataset="people"', 'dataset="PEOPLE"')
              .replace(/simpleEntity/g, 'simpleEntity2'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          // publish "people"
          await asAlice.post('/v1/projects/1/forms/simpleEntity/draft/publish');

          // try to create "PEOPLE" via API
          await asAlice.post('/v1/projects/1/datasets')
            .send({
              name: 'PEOPLE'
            })
            .expect(409)
            .then(({ body }) => {
              body.code.should.equal(409.16);
              body.message.should.startWith("A dataset named 'people' exists and you provided 'PEOPLE'");
            });
        }));
      });

      it('should add label-only entity to dataset, all via API', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets')
          .send({
            name: 'trees'
          })
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/trees/entities')
          .send({
            uuid: '12345678-1234-4123-8234-123456789aaa',
            label: 'Willow',
            data: {}
          })
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/trees/entities')
          .then(({ body }) => {
            body.length.should.equal(1);
          });

        const result = await asAlice.get('/v1/projects/1/datasets/trees/entities.csv')
          .expect(200)
          .then(r => r.text);

        const isoRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g;

        result.match(isoRegex).should.have.length(1);

        const withOutTs = result.replace(isoRegex, '');
        withOutTs.should.be.eql(
          '__id,label,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n' +
          '12345678-1234-4123-8234-123456789aaa,Willow,,5,Alice,0,,1\n'
        );
      }));

      it('should log an event in the audit log for creating a new dataset', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets')
          .send({
            name: 'trees'
          })
          .expect(200);

        await asAlice.get('/v1/audits')
          .set('X-Extended-Metadata', 'true')
          .then(({ body: logs }) => {
            logs[0].action.should.equal('dataset.create');
            logs[0].actorId.should.equal(5);
            logs[0].actee.should.be.a.Dataset();
            logs[0].actee.name.should.equal('trees');
            logs[0].details.properties.should.eql([]);
          });
      }));
    });

    describe('projects/:id/datasets/:dataset/properties POST', () => {
      it('should reject user does not have dataset update access', testService(async (service) => {
        const asAlice = await service.login('alice');
        const asChelsea = await service.login('chelsea');

        await asAlice.post('/v1/projects/1/datasets')
          .send({
            name: 'trees'
          })
          .expect(200);

        await asChelsea.post('/v1/projects/1/datasets/trees/properties')
          .send({ name: 'trees' })
          .expect(403);

      }));

      it('should add property to dataset and return success', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets')
          .send({
            name: 'trees'
          })
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/trees/properties')
          .send({
            name: 'height'
          })
          .expect(200)
          .then(({ body }) => {
            body.success.should.be.true();
          });
      }));

      it('should accept entities with properties after properties have been added', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets')
          .send({
            name: 'trees'
          })
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/trees')
          .then(({ body }) => {
            body.properties.should.eql([]);
            body.sourceForms.should.eql([]);
          });

        await asAlice.post('/v1/projects/1/datasets/trees/entities')
          .send({
            label: 'redwood',
            data: { height: '120' }
          })
          .expect(400)
          .then(({ body }) => {
            body.message.should.equal('The entity is invalid. You specified the dataset property [height] which does not exist.');
          });

        await asAlice.post('/v1/projects/1/datasets/trees/properties')
          .send({
            name: 'height'
          })
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/trees')
          .then(({ body }) => {
            body.properties[0].name.should.equal('height');
            body.sourceForms.should.eql([]);
          });

        await asAlice.post('/v1/projects/1/datasets/trees/entities')
          .send({
            uuid: '12345678-1234-4123-8234-123456789aaa',
            label: 'redwood',
            data: { height: '120' }
          })
          .expect(200);

        const result = await asAlice.get('/v1/projects/1/datasets/trees/entities.csv')
          .expect(200)
          .then(r => r.text);

        const isoRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g;

        result.match(isoRegex).should.have.length(1);

        const withOutTs = result.replace(isoRegex, '');
        withOutTs.should.be.eql(
          '__id,label,height,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n' +
          '12345678-1234-4123-8234-123456789aaa,redwood,120,,5,Alice,0,,1\n'
        );
      }));

      it('should reject if property name is invalid', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets')
          .send({ name: 'trees' })
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/trees/properties')
          .send({
            name: 'name'
          })
          .expect(400)
          .then(({ body }) => {
            body.message.should.equal('Unexpected name value name; This is not a valid property name.');
          });
      }));

      it('should reject if property name is not provided', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets')
          .send({ name: 'trees' })
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/trees/properties')
          .send({})
          .expect(400)
          .then(({ body }) => {
            body.message.should.equal('Unexpected name value undefined; This is not a valid property name.');
          });
      }));

      it('should reject if property name is null', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets')
          .send({ name: 'trees' })
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/trees/properties')
          .send({
            name: null
          })
          .expect(400)
          .then(({ body }) => {
            body.message.should.equal('Unexpected name value null; This is not a valid property name.');
          });
      }));

      it('should reject if creating a dataset property that already exists', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets')
          .send({
            name: 'trees'
          })
          .expect(200);

        // Create a property
        await asAlice.post('/v1/projects/1/datasets/trees/properties')
          .send({
            name: 'height'
          })
          .expect(200);

        // Second time should fail
        await asAlice.post('/v1/projects/1/datasets/trees/properties')
          .send({
            name: 'height'
          })
          .expect(409)
          .then(({ body }) => {
            body.code.should.equal(409.3);
            body.message.should.startWith('A resource already exists with name,datasetId value(s) of height');
          });
      }));

      it('should reject if creating a dataset property that already exists but with different capitalization', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets')
          .send({
            name: 'trees'
          })
          .expect(200);

        // Create a property
        await asAlice.post('/v1/projects/1/datasets/trees/properties')
          .send({
            name: 'height'
          })
          .expect(200);

        // Second time should fail
        await asAlice.post('/v1/projects/1/datasets/trees/properties')
          .send({
            name: 'HEIGHT'
          })
          .expect(409)
          .then(({ body }) => {
            body.code.should.equal(409.3);
            body.message.should.match(/A resource already exists with name,datasetId/);
          });
      }));

      it('should log an event for creating a new dataset property', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets')
          .send({
            name: 'trees'
          })
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/trees/properties')
          .send({
            name: 'circumference'
          })
          .expect(200);

        await asAlice.get('/v1/audits')
          .set('X-Extended-Metadata', 'true')
          .then(({ body: logs }) => {
            logs[0].action.should.equal('dataset.update');
            logs[0].actorId.should.equal(5);
            logs[0].actee.should.be.a.Dataset();
            logs[0].actee.name.should.equal('trees');
            logs[0].details.properties.should.eql(['circumference']);
          });
      }));

      it('should allow property name from a deleted draft form be used', testService(async (service) => {
        const asAlice = await service.login('alice');

        // Create a draft dataset
        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        // Delete the draft form
        await asAlice.delete('/v1/projects/1/forms/simpleEntity')
          .expect(200);

        // Create the dataset with the same name as the dataset in the deleted form
        await asAlice.post('/v1/projects/1/datasets')
          .send({ name: 'people' })
          .expect(200);

        // Create a property with a name that wasn't originally in the dataset in the form
        await asAlice.post('/v1/projects/1/datasets/people/properties')
          .send({ name: 'nickname' })
          .expect(200);

        // Create a property with a name that was in the dataset in the form
        await asAlice.post('/v1/projects/1/datasets/people/properties')
          .send({ name: 'age' })
          .expect(200);

        // Re-creating an existing property should result in an error
        await asAlice.post('/v1/projects/1/datasets/people/properties')
          .send({ name: 'age' })
          .expect(409)
          .then(({ body }) => {
            body.code.should.equal(409.3);
            body.message.should.startWith('A resource already exists with name,datasetId value(s) of age');
          });
      }));
    });
  });

  describe('listing and downloading datasets', () => {
    describe('projects/:id/datasets GET', () => {
      it('should reject if the user cannot list datasets', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.get('/v1/projects/1/datasets')
                .expect(403))))));

      it('should return the datasets of Default project', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() =>
              asAlice.get('/v1/projects/1/datasets')
                .expect(200)
                .then(({ body }) => {
                  body.length.should.equal(1);
                  body[0].should.be.a.Dataset();
                  body[0].should.containEql({ name: 'people', projectId: 1 });
                })))));

      it('should return the extended datasets of Default project', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].should.be.an.ExtendedDataset();
            body[0].should.containEql({ name: 'people', projectId: 1, entities: 1, conflicts: 0 });
          });
      }));

      it('should not return draft datasets', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity
                .replace(/simpleEntity/, 'simpleEntity2')
                .replace(/people/, 'student'))
              .expect(200)
              .then(() =>
                asAlice.get('/v1/projects/1/datasets')
                  .expect(200)
                  .then(({ body }) => {
                    body.length.should.equal(1);
                    body[0].should.be.a.Dataset();
                    body[0].name.should.equal('student');
                  }))))));
    });

    describe('projects/:id/datasets GET extended', () => {

      it('should return the 0 for entities', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].should.be.an.ExtendedDataset();
            body[0].should.containEql({
              name: 'people',
              entities: 0,
              lastEntity: null,
              conflicts: 0,
            });
          });
      }));

      it('should return the extended datasets of Default project', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
          .send({
            label: 'Alice - updated'
          })
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].should.be.an.ExtendedDataset();
            body[0].should.containEql({ name: 'people', projectId: 1, entities: 1, conflicts: 0 });
            body[0].lastEntity.should.not.be.null();
          });
      }));

      it('should return the correct count and latest timestamp of entities', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
          .send({ data: { age: '99' } })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.updateEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        // all properties changed
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        await container.run(sql`UPDATE entities SET "createdAt" = '1999-1-1T00:00:00Z', "updatedAt" = '1999-1-1T00:00:00Z' WHERE TRUE`);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.two)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/two')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].should.be.an.ExtendedDataset();
            body[0].should.containEql({ name: 'people', entities: 2, conflicts: 1 });
            body[0].lastEntity.should.not.startWith('1999');
          });
      }));

      it('should exclude deleted entities', testService(async (service) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Johnny Doe'
          })
          .expect(200);
        await asAlice.get('/v1/projects/1/datasets')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].entities.should.equal(1);
            body[0].lastEntity.should.be.an.isoDate();
          });
        await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200);
        await asAlice.get('/v1/projects/1/datasets')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].entities.should.equal(0);
            should.not.exist(body[0].lastEntity);
          });
      }));

      it('should return the correct count for multiple dataset', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        // Create Datasets
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity
            .replace(/simpleEntity/g, 'simpleEntity2')
            .replace(/people/g, 'trees'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        // Make submissions
        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.two)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity2/submissions')
          .send(testData.instances.simpleEntity.one
            .replace(/simpleEntity/g, 'simpleEntity2')
            .replace(/123456789abc/g, '123456789000') // we have uniqueness contrainst on UUID for the whole table
            .replace(/people/g, 'trees'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        // Approve submissions
        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/two')
          .send({ reviewState: 'approved' })
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity2/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.map(({ createdAt, lastEntity, ...d }) => {
              createdAt.should.not.be.null();
              lastEntity.should.not.be.null();
              return d;
            }).reduce((a, v) => ({ ...a, [v.name]: v.entities }), {}).should.eql({
              people: 2, trees: 1
            });
          });
      }));
    });

    describe('projects/:id/datasets/:dataset.csv GET', () => {
      it('should reject if the user cannot access dataset', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.get('/v1/projects/1/datasets/people/entities.csv')
                .expect(403))))));

      it('should let the user download the dataset (even if 0 entity rows)', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/datasets/people/entities.csv')
              .expect(200)
              .then(({ text }) => {
                text.should.equal('__id,label,first_name,age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n');
              })))));

      it('should return only published properties', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity
            .replace(/simpleEntity/g, 'simpleEntity2')
            .replace(/first_name/, 'full_name'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .expect(200)
          .then(({ text }) => {
            text.should.equal('__id,label,first_name,age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n');
          });

      }));

      it('should reject if dataset does not exist', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/datasets/nonexistent/entities.csv')
              .expect(404)))));

      it('should reject if dataset is not published', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/datasets/people/entities.csv')
              .expect(404)))));

      it('should return csv file with data', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.two)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        const result = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .expect(200)
          .then(r => r.text);

        const isoRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g;

        result.match(isoRegex).should.have.length(2);

        const withOutTs = result.replace(isoRegex, '');
        withOutTs.should.be.eql(
          '__id,label,first_name,age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n' +
          '12345678-1234-4123-8234-123456789aaa,Jane (30),Jane,30,,5,Alice,0,,1\n' +
          '12345678-1234-4123-8234-123456789abc,Alice (88),Alice,88,,5,Alice,0,,1\n'
        );

      }));

      it('should return csv file for dataset that have dot in its property name', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/age/g, 'the.age'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one.replace(/age/g, 'the.age'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        const result = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .expect(200)
          .then(r => r.text);

        const isoRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g;

        result.match(isoRegex).should.have.length(1);

        const withOutTs = result.replace(isoRegex, '');
        withOutTs.should.be.eql(
          '__id,label,first_name,the.age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n' +
          '12345678-1234-4123-8234-123456789abc,Alice (88),Alice,88,,5,Alice,0,,1\n'
        );

      }));

      it('should stream csv of dataset with entities from multiple forms', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.multiPropertyEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity
            .replace('multiPropertyEntity', 'multiPropertyEntity2')
            .replace('b_q1', 'f_q1')
            .replace('d_q2', 'e_q2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/multiPropertyEntity/draft/publish').expect(200);

        await asAlice.post('/v1/projects/1/forms/multiPropertyEntity/submissions')
          .send(testData.instances.multiPropertyEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/multiPropertyEntity/submissions')
          .send(testData.instances.multiPropertyEntity.two)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/multiPropertyEntity2/submissions')
          .send(testData.instances.multiPropertyEntity.one
            .replace('multiPropertyEntity', 'multiPropertyEntity2')
            .replace('uuid:12345678-1234-4123-8234-123456789aaa', 'uuid:12345678-1234-4123-8234-123456789ccc')
            .replace('b_q1', 'f_q1')
            .replace('d_q2', 'e_q2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/multiPropertyEntity/submissions/one')
          .send({ reviewState: 'approved' });
        await asAlice.patch('/v1/projects/1/forms/multiPropertyEntity/submissions/two')
          .send({ reviewState: 'approved' });
        await asAlice.patch('/v1/projects/1/forms/multiPropertyEntity2/submissions/one')
          .send({ reviewState: 'approved' });

        await exhaust(container);

        const { text } = await asAlice.get('/v1/projects/1/datasets/foo/entities.csv');

        const withOutTs = text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g, '');
        withOutTs.should.be.eql(
          '__id,label,f_q1,e_q2,a_q3,c_q4,b_q1,d_q2,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n' +
          '12345678-1234-4123-8234-123456789ccc,one,w,x,y,z,,,,5,Alice,0,,1\n' +
          '12345678-1234-4123-8234-123456789bbb,two,,,c,d,a,b,,5,Alice,0,,1\n' +
          '12345678-1234-4123-8234-123456789aaa,one,,,y,z,w,x,,5,Alice,0,,1\n'
        );
      }));

      it('should not return deleted entities', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            uuid: '12345678-1234-4123-8234-111111111aaa',
            label: 'Johnny Doe',
            data: { first_name: 'Johnny', age: '22' }
          })
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            uuid: '12345678-1234-4123-8234-111111111bbb',
            label: 'Robert Doe',
            data: { first_name: 'Robert', age: '88' }
          })
          .expect(200);

        await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111bbb');

        const result = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .expect(200)
          .then(r => r.text);

        result.should.not.match(/Robert Doe/);

      }));

      it('should return updated value correctly (entity updated via API)', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            uuid: '12345678-1234-4123-8234-111111111aaa',
            label: 'Johnny Doe',
            data: { first_name: 'Johnny', age: '22' }
          })
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111aaa?force=true')
          .send({
            data: { first_name: 'Robert', age: '' },
            label: 'Robert Doe (expired)'
          })
          .expect(200);

        const result = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .expect(200)
          .then(r => r.text);

        const isoRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g;

        result.match(isoRegex).should.have.length(2);

        const withOutTs = result.replace(isoRegex, '');
        withOutTs.should.be.eql(
          '__id,label,first_name,age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n' +
          '12345678-1234-4123-8234-111111111aaa,Robert Doe (expired),Robert,,,5,Alice,1,,2\n'
        );

      }));

      it('should return updated value correctly (entity updated via submission)', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Johnny Doe',
            data: { first_name: 'Johnny', age: '22' }
          })
          .expect(200);

        // create form and submission to update entity
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.updateEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        const result = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .expect(200)
          .then(r => r.text);

        const isoRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g;

        result.match(isoRegex).should.have.length(2);

        const withOutTs = result.replace(isoRegex, '');
        withOutTs.should.be.eql(
          '__id,label,first_name,age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n' +
          '12345678-1234-4123-8234-123456789abc,Alicia (85),Alicia,85,,5,Alice,1,,2\n'
        );

      }));

      it('should filter the Entities', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            uuid: '12345678-1234-4123-8234-111111111aaa',
            label: 'Johnny Doe',
            data: { first_name: 'Johnny', age: '22' }
          })
          .expect(200);

        await createConflict(asAlice, container);

        const result = await asAlice.get('/v1/projects/1/datasets/people/entities.csv?$filter=__system/conflict eq \'hard\'')
          .expect(200)
          .then(r => {
            should.not.exist(r.get('ETag'));
            return r.text;
          });

        const isoRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g;

        result.match(isoRegex).should.have.length(2);

        const withOutTs = result.replace(isoRegex, '');
        withOutTs.should.be.eql(
          '__id,label,first_name,age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n' +
          '12345678-1234-4123-8234-123456789abc,Alicia (85),Alicia,85,,5,Alice,2,,3\n'
        );

      }));

      describe('ETag on entities.csv', () => {
        it('should return 304 content not changed if ETag matches', testService(async (service, container) => {
          const asAlice = await service.login('alice');

          await asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
            .send(testData.instances.simpleEntity.one)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await exhaust(container);

          const result = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
            .expect(200);

          const withOutTs = result.text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g, '');
          withOutTs.should.be.eql(
            '__id,label,first_name,age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n' +
            '12345678-1234-4123-8234-123456789abc,Alice (88),Alice,88,,5,Alice,0,,1\n'
          );

          const etag = result.get('ETag');

          await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
            .set('If-None-Match', etag)
            .expect(304);
        }));

        it('should return new ETag if entity data is modified', testService(async (service) => {
          const asAlice = await service.login('alice');

          await asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/datasets/people/entities')
            .send({
              uuid: '12345678-1234-4123-8234-111111111aaa',
              label: 'Alice',
              data: { first_name: 'Alice' }
            })
            .expect(200);

          const result = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
            .expect(200);

          const withOutTs = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g;
          result.text.replace(withOutTs, '').should.be.eql(
            '__id,label,first_name,age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n' +
            '12345678-1234-4123-8234-111111111aaa,Alice,Alice,,,5,Alice,0,,1\n'
          );

          const etag = result.get('ETag');

          await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111aaa?force=true')
            .send({ data: { age: '33' } })
            .expect(200);

          const modifiedResult = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
            .set('If-None-Match', etag)
            .expect(200);

          modifiedResult.text.replace(withOutTs, '').should.be.eql(
            '__id,label,first_name,age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n' +
            '12345678-1234-4123-8234-111111111aaa,Alice,Alice,33,,5,Alice,1,,2\n'
          );
        }));

        it('should return new ETag if entity deleted', testService(async (service) => {
          const asAlice = await service.login('alice');

          await asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          // bulk create several entities
          await asAlice.post('/v1/projects/1/datasets/people/entities')
            .set('User-Agent', 'central/tests')
            .send({
              source: {
                name: 'people.csv',
                size: 100,
              },
              entities: [
                {
                  uuid: '12345678-1234-4123-8234-111111111aaa',
                  label: 'Alice',
                  data: { first_name: 'Alice' }
                },
                {
                  uuid: '12345678-1234-4123-8234-111111111bbb',
                  label: 'Emily',
                  data: { first_name: 'Emily' }
                },
              ]
            });

          const result = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
            .expect(200);

          const withOutTs = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g;
          result.text.replace(withOutTs, '').should.be.eql(
            '__id,label,first_name,age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n' +
            '12345678-1234-4123-8234-111111111bbb,Emily,Emily,,,5,Alice,0,,1\n' +
            '12345678-1234-4123-8234-111111111aaa,Alice,Alice,,,5,Alice,0,,1\n'
          );

          const etag = result.get('ETag');

          await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111bbb');

          await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
            .set('If-None-Match', etag)
            .expect(200); // should not be 304

          const deletedResult = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
            .expect(200);

          deletedResult.text.replace(withOutTs, '').should.be.eql(
            '__id,label,first_name,age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n' +
            '12345678-1234-4123-8234-111111111aaa,Alice,Alice,,,5,Alice,0,,1\n'
          );
        }));
      });
    });

    describe('projects/:id/datasets/:name GET', () => {

      it('should return the metadata of the dataset', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/age/g, 'the.age'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity
            .replace(/simpleEntity/, 'simpleEntity2')
            .replace(/age/g, 'address'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.withAttachments
            .replace(/goodone.csv/, 'people.csv'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people')
          .expect(200)
          .then(({ body }) => {

            const { createdAt, linkedForms, properties, sourceForms, lastUpdate, ...ds } = body;

            ds.should.be.eql({
              name: 'people',
              projectId: 1,
              approvalRequired: false,
              ownerOnly: false
            });

            createdAt.should.not.be.null();

            lastUpdate.should.be.isoDate();

            linkedForms.should.be.eql([{ name: 'withAttachments', xmlFormId: 'withAttachments' }]);

            sourceForms.should.be.eql([
              { name: 'simpleEntity', xmlFormId: 'simpleEntity' },
              { name: 'simpleEntity2', xmlFormId: 'simpleEntity2' }]);

            properties.map(({ publishedAt, ...p }) => {
              publishedAt.should.be.isoDate();
              return p;
            }).should.be.eql([
              {
                name: 'first_name', odataName: 'first_name', forms: [
                  { name: 'simpleEntity', xmlFormId: 'simpleEntity' },
                  { name: 'simpleEntity2', xmlFormId: 'simpleEntity2' }
                ]
              },
              { name: 'the.age', odataName: 'the_age', forms: [{ name: 'simpleEntity', xmlFormId: 'simpleEntity' },] },
              { name: 'address', odataName: 'address', forms: [{ name: 'simpleEntity2', xmlFormId: 'simpleEntity2' },] }
            ]);

          });

      }));

      it('should return the extended metadata of the dataset', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            uuid: '12345678-1234-4123-8234-111111111aaa',
            label: 'Johnny Doe'
          })
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111aaa?force=true')
          .send({
            label: 'Johnny Doe - updated'
          })
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {

            const { createdAt, properties, lastEntity, lastUpdate, ...ds } = body;

            ds.should.be.eql({
              name: 'people',
              projectId: 1,
              approvalRequired: false,
              ownerOnly: false,
              entities: 1,
              conflicts: 0,
              linkedForms: [],
              sourceForms: [{ name: 'simpleEntity', xmlFormId: 'simpleEntity' }]
            });

            lastEntity.should.be.recentIsoDate();
            lastUpdate.should.be.recentIsoDate();
            createdAt.should.be.recentIsoDate();

            properties.map(({ publishedAt, ...p }) => {
              publishedAt.should.be.isoDate();
              return p;
            }).should.be.eql([
              { name: 'first_name', odataName: 'first_name', forms: [{ name: 'simpleEntity', xmlFormId: 'simpleEntity' }] },
              { name: 'age', odataName: 'age', forms: [{ name: 'simpleEntity', xmlFormId: 'simpleEntity' },] }
            ]);

          });

      }));

      it('should reject if dataset is not published', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/datasets/people')
              .expect(404)))));

      it('should not return duplicate linkedForms', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.withAttachments
            .replace(/goodone.csv/, 'people.csv'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/withAttachments/draft')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish?version=2.0')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people')
          .expect(200)
          .then(({ body }) => {

            const { linkedForms } = body;

            linkedForms.should.be.eql([{ name: 'withAttachments', xmlFormId: 'withAttachments' }]);
          });

      }));

      it('should not return a linked form that has been deleted', testService(async (service) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);
        const withAttachments = testData.forms.withAttachments
          .replace('goodone.csv', 'people.csv');
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(withAttachments)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(withAttachments
            .replace('id="withAttachments"', 'id="withAttachments2"'))
          .set('Content-Type', 'application/xml')
          .expect(200);
        const { body: beforeDeletion } = await asAlice.get('/v1/projects/1/datasets/people')
          .expect(200);
        beforeDeletion.linkedForms.map(form => form.xmlFormId).should.eql([
          'withAttachments',
          'withAttachments2'
        ]);
        await asAlice.delete('/v1/projects/1/forms/withAttachments2')
          .expect(200);
        const { body: afterDeletion } = await asAlice.get('/v1/projects/1/datasets/people')
          .expect(200);
        afterDeletion.linkedForms.map(form => form.xmlFormId).should.eql([
          'withAttachments'
        ]);
      }));

      it('should not return a form draft as a linked form', testService(async (service) => {
        const asAlice = await service.login('alice');
        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.withAttachments
            .replace('goodone.csv', 'people.csv'))
          .set('Content-Type', 'application/xml')
          .expect(200);
        await asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/people.csv')
          .send('test,csv\n1,2')
          .set('Content-Type', 'text/csv')
          .expect(200);
        await asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
          .expect(200);
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await asAlice.post('/v1/projects/1/forms/withAttachments/draft')
          .expect(200);
        await asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/people.csv')
          .send({ dataset: true })
          .expect(200);
        const { body: publishedAttachments } = await asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
          .expect(200);
        const publishedCSV = publishedAttachments.find(attachment =>
          attachment.name === 'people.csv');
        publishedCSV.should.containEql({
          blobExists: true,
          datasetExists: false
        });
        const { body: draftAttachments } = await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments')
          .expect(200);
        const draftCSV = draftAttachments.find(attachment =>
          attachment.name === 'people.csv');
        draftCSV.should.containEql({
          blobExists: false,
          datasetExists: true
        });
        const { body: dataset } = await asAlice.get('/v1/projects/1/datasets/people')
          .expect(200);
        dataset.linkedForms.length.should.equal(0);
      }));

      it('should return properties of a dataset in order', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/foo')
          .expect(200)
          .then(({ body }) => {
            const { properties } = body;
            properties.map((p) => p.name)
              .should.be.eql([
                'b_q1',
                'd_q2',
                'a_q3',
                'c_q4'
              ]);
          });
      }));

      it('should return dataset properties from multiple forms in order', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity
            .replace('multiPropertyEntity', 'multiPropertyEntity2')
            .replace('b_q1', 'f_q1')
            .replace('d_q2', 'e_q2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/foo')
          .expect(200)
          .then(({ body }) => {
            const { properties } = body;
            properties.map((p) => p.name)
              .should.be.eql([
                'b_q1',
                'd_q2',
                'a_q3',
                'c_q4',
                'f_q1',
                'e_q2'
              ]);
          });
      }));

      it('should return dataset properties from multiple forms where later form publishes dataset', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.multiPropertyEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity
            .replace('multiPropertyEntity', 'multiPropertyEntity2')
            .replace('b_q1', 'f_q1')
            .replace('d_q2', 'e_q2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/multiPropertyEntity/draft/publish');

        await asAlice.get('/v1/projects/1/datasets/foo')
          .expect(200)
          .then(({ body }) => {
            const { properties } = body;
            properties.map((p) => p.name)
              .should.be.containDeep([
                'f_q1',
                'e_q2',
                'a_q3',
                'c_q4',
                'b_q1',
                'd_q2',
              ]);
          });
      }));

      it('should return dataset properties from multiple forms including updated form with updated schema', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity
            .replace('multiPropertyEntity', 'multiPropertyEntity2')
            .replace('b_q1', 'f_q1')
            .replace('d_q2', 'e_q2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/multiPropertyEntity/draft')
          .send(testData.forms.multiPropertyEntity
            .replace('orx:version="1.0"', 'orx:version="2.0"')
            .replace('b_q1', 'g_q1'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/multiPropertyEntity/draft/publish').expect(200);

        await asAlice.get('/v1/projects/1/datasets/foo')
          .expect(200)
          .then(({ body }) => {
            const { properties } = body;
            properties.map((p) => p.name)
              .should.be.eql([
                'b_q1',
                'd_q2',
                'a_q3',
                'c_q4',
                'f_q1',
                'e_q2',
                'g_q1'
              ]);
          });
      }));

      it('should return dataset properties when purged draft form shares some properties', testService(async (service, { Forms }) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.multiPropertyEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity
            .replace('multiPropertyEntity', 'multiPropertyEntity2')
            .replace('b_q1', 'f_q1')
            .replace('d_q2', 'e_q2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.delete('/v1/projects/1/forms/multiPropertyEntity')
          .expect(200);

        await Forms.purge(true);

        await asAlice.get('/v1/projects/1/datasets/foo')
          .expect(200)
          .then(({ body }) => {
            const { properties } = body;
            properties.map((p) => p.name)
              .should.be.eql([
                'f_q1',
                'e_q2',
                'a_q3',
                'c_q4'
              ]);
          });
      }));

      it('should return dataset properties when draft form (purged before second form publish) shares some properties', testService(async (service, { Forms }) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.multiPropertyEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.multiPropertyEntity
            .replace('multiPropertyEntity', 'multiPropertyEntity2')
            .replace('b_q1', 'f_q1')
            .replace('d_q2', 'e_q2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.delete('/v1/projects/1/forms/multiPropertyEntity')
          .expect(200);

        await Forms.purge(true);

        await asAlice.post('/v1/projects/1/forms/multiPropertyEntity2/draft/publish');

        await asAlice.get('/v1/projects/1/datasets/foo')
          .expect(200)
          .then(({ body }) => {
            const { properties } = body;
            properties.map((p) => p.name)
              .should.be.eql([
                'f_q1',
                'e_q2',
                'a_q3',
                'c_q4'
              ]);
          });
      }));

      it.skip('should return ordered dataset properties including from deleted published form', testService(async (service, { Forms }) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.delete('/v1/projects/1/forms/multiPropertyEntity')
          .expect(200);

        await Forms.purge(true);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity
            .replace('multiPropertyEntity', 'multiPropertyEntity2')
            .replace('b_q1', 'f_q1')
            .replace('d_q2', 'e_q2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/foo')
          .expect(200)
          .then(({ body }) => {
            const { properties } = body;
            // Properties are coming out in this other order:
            // [ 'a_q3', 'c_q4', 'b_q1', 'd_q2', 'f_q1', 'e_q2' ]
            // It's not terrible but would rather all the props of the first form
            // show up first.
            properties.map((p) => p.name)
              .should.be.eql([
                'b_q1',
                'd_q2',
                'a_q3',
                'c_q4',
                'f_q1',
                'e_q2'
              ]);
          });
      }));

      // bug # 833
      it('should not return null in properties.forms when creation form is updated', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft/publish?version=v2.0')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people')
          .expect(200)
          .then(({ body }) => {
            body.properties[0].name.should.be.eql('first_name');
            body.properties[0].forms.should.be.eql([
              {
                xmlFormId: 'simpleEntity',
                name: 'simpleEntity'
              }
            ]);

            body.properties[1].name.should.be.eql('age');
            body.properties[1].forms.should.be.eql([
              {
                xmlFormId: 'simpleEntity',
                name: 'simpleEntity'
              }
            ]);
          });
      }));


      // bug # 833
      it('should not return deleted form', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.delete('/v1/projects/1/forms/simpleEntity')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft/publish?version=v2')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people')
          .expect(200)
          .then(({ body }) => {
            body.properties[0].name.should.be.eql('first_name');
            body.properties[0].forms.should.be.eql([
              {
                xmlFormId: 'simpleEntity',
                name: 'simpleEntity'
              }
            ]);

            body.properties[1].name.should.be.eql('age');
            body.properties[1].forms.should.be.eql([
              {
                xmlFormId: 'simpleEntity',
                name: 'simpleEntity'
              }
            ]);
          });
      }));

      // bug central#464
      it('should return source form that does not set any property', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/entities:saveto.*/g, '/>'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people')
          .expect(200)
          .then(({ body }) => {
            body.sourceForms.should.be.eql([{ name: 'simpleEntity', xmlFormId: 'simpleEntity' }]);
          });

      }));

    });
  });

  describe('linking form attachments to datasets', () => {
    describe('projects/:id/forms/:formId/draft/attachment/:name PATCH', () => {
      it('should reject unless user can form.update', testService((service) =>
        service.login(['alice', 'chelsea'], (asAlice, asChelsea) =>
          Promise.all([
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments)
              .set('Content-Type', 'application/xml')
              .expect(200),
            asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace('people', 'goodone'))
              .set('Content-Type', 'application/xml')
              .expect(200)
          ])
            .then(() => asChelsea.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send({ dataset: true })
              .expect(403)))));

      it('should reject if user can form.update but not entity.list', testService((service) =>
        service.login(['alice', 'chelsea'], (asAlice, asChelsea) =>
          Promise.all([
            asChelsea.get('/v1/users/current')
              .expect(200)
              .then(({ body }) => body.id),
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments)
              .set('Content-Type', 'application/xml')
              .expect(200),
            asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace('people', 'goodone'))
              .set('Content-Type', 'application/xml')
              .expect(200)
          ])
            .then(([chelseaId]) => asAlice.post(`/v1/projects/1/forms/withAttachments/assignments/manager/${chelseaId}`)
              .expect(200))
            .then(() => asChelsea.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send({ dataset: true })
              .expect(403)))));

      it('should link dataset to form using PATCH', testService(async (service) => {
        const asAlice = await service.login('alice');

        // Upload form with attachment goodone.csv
        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.withAttachments)
          .set('Content-Type', 'application/xml')
          .expect(200);

        // Upload and publish form to create dataset with name 'goodone'
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/people/, 'goodone'));

        // Patch attachment in first form to use dataset
        await asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .send({ dataset: true })
          .expect(200)
          .then(({ body }) => {
            body.should.be.a.FormAttachment();
            omit(['updatedAt'], body).should.be.eql({
              name: 'goodone.csv',
              type: 'file',
              exists: true,
              blobExists: false,
              datasetExists: true
            });
          });

        // Publish form with dataset as attachment
        await asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish?version=newversion')
          .expect(200);

        // Check that attachment is dataset
        await asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
          .expect(200)
          .then(({ body }) => {
            body[0].should.be.a.FormAttachment();
            body[0].name.should.equal('goodone.csv');
            body[0].datasetExists.should.equal(true);
            body[0].updatedAt.should.be.a.recentIsoDate();
          });
      }));

      it('should return dataset attachment in form manifest', testService(async (service) => {
        const asAlice = await service.login('alice');

        // Upload form to create dataset with name 'goodone'
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/people/, 'goodone'));

        // Upload form to consume dataset as attachment (named goodone.csv)
        // Dataset will get autolinked to attachment because name matches
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.withAttachments)
          .set('Content-Type', 'application/xml')
          .expect(200);

        // Fetch the etag on the dataset CSV, which should match the manifest md5
        const result = await asAlice.get('/v1/projects/1/datasets/goodone/entities.csv')
          .expect(200);
        const etag = result.get('ETag');

        // Fetch the form manifest
        const manifest = await asAlice.get('/v1/projects/1/forms/withAttachments/manifest')
          .set('X-OpenRosa-Version', '1.0')
          .expect(200)
          .then(({ text }) => text);

        const domain = config.get('default.env.domain');
        manifest.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
    <mediaFile type="entityList">
      <filename>goodone.csv</filename>
      <hash>md5:${etag.replace(/"/g, '')}</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withAttachments/attachments/goodone.csv</downloadUrl>
      <integrityUrl>${domain}/v1/projects/1/datasets/goodone/integrity</integrityUrl>
    </mediaFile>
  </manifest>`);
      }));

      it('should override blob and link dataset', testService(async (service, { Forms, FormAttachments, Audits, Datasets }) => {
        const asAlice = await service.login('alice');

        // Upload draft form with attachment named 'goodone.csv'
        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.withAttachments)
          .set('Content-Type', 'application/xml')
          .expect(200);

        // Upload form to create a dataset called 'goodone'
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/people/, 'goodone'));

        // Attach a normal csv to the form attachment
        await asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .send('test,csv\n1,2')
          .set('Content-Type', 'text/csv')
          .expect(200);

        // Check that attachment is currently a blob
        await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments')
          .expect(200)
          .then(({ body }) => {
            body[0].should.be.a.FormAttachment();
            body[0].name.should.equal('goodone.csv');
            body[0].exists.should.equal(true);
            body[0].datasetExists.should.equal(false);
            body[0].blobExists.should.equal(true);
            body[0].updatedAt.should.be.a.recentIsoDate();
          });

        // For bookkeeping later
        // Get blob id of original CSV file
        const form = await Forms.getByProjectAndXmlFormId(1, 'withAttachments', Form.DraftVersion).then((o) => o.get());
        const attachment = await FormAttachments.getByFormDefIdAndName(form.draftDefId, 'goodone.csv').then((o) => o.get());

        // Update attachment to link to dataset instead of csv file
        await asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .send({ dataset: true });

        // Check that attachment is now a dataset
        await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments')
          .expect(200)
          .then(({ body }) => {
            body[0].should.be.a.FormAttachment();
            body[0].name.should.equal('goodone.csv');
            body[0].exists.should.equal(true);
            body[0].datasetExists.should.equal(true);
            body[0].blobExists.should.equal(false);
            body[0].updatedAt.should.be.a.recentIsoDate();
          });

        // Check bookkeeping
        const dataset = await Datasets.get(1, 'goodone').then((o) => o.get());
        const audit = await Audits.getLatestByAction('form.attachment.update').then((o) => o.get());
        audit.details.should.be.eql({
          formDefId: form.draftDefId,
          name: 'goodone.csv',
          oldBlobId: attachment.blobId,
          newBlobId: null,
          oldDatasetId: null,
          newDatasetId: dataset.id
        });

        // Fetch the etag on the dataset CSV, which should match the manifest md5
        const result = await asAlice.get('/v1/projects/1/datasets/goodone/entities.csv')
          .expect(200);
        const etag = result.get('ETag');

        // Fetch the form manifest
        const manifest = await asAlice.get('/v1/projects/1/forms/withAttachments/manifest')
          .set('X-OpenRosa-Version', '1.0')
          .expect(200)
          .then(({ text }) => text);

        const domain = config.get('default.env.domain');
        manifest.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
    <mediaFile type="entityList">
      <filename>goodone.csv</filename>
      <hash>md5:${etag.replace(/"/g, '')}</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withAttachments/attachments/goodone.csv</downloadUrl>
      <integrityUrl>${domain}/v1/projects/1/datasets/goodone/integrity</integrityUrl>
    </mediaFile>
  </manifest>`);
      }));

      it('should allow an attachment to have a .CSV extension', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments.replace('goodone.csv', 'goodone.CSV'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace('people', 'goodone'))
              .expect(200))
            .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.CSV')
              .send({ dataset: true })
              .expect(200)
              .then(({ body }) => {
                body.should.be.a.FormAttachment();
                body.datasetExists.should.be.true();
              })))));

      it('should unlink dataset from the form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace(/people/, 'goodone')))
            .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send({ dataset: true })
              .expect(200))
            .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send({ dataset: false })
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
              .expect(200)
              .then(({ body }) => {
                body[0].should.be.a.FormAttachment();
                body[0].name.should.equal('goodone.csv');
                body[0].datasetExists.should.equal(false);
                body[0].updatedAt.should.be.a.recentIsoDate();
              }))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/manifest')
              .set('X-OpenRosa-Version', '1.0')
              .expect(200)
              .then(({ text }) => {
                text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
  </manifest>`);
              })))));

      it('should return error if dataset is not found', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send({ dataset: true })
              .expect(404)))));

      // Here withAttachment form has an audio file without extension
      // hence dataset name is matching but because file type is audio
      // it should return problem
      it('should throw problem if datasetId is being set for non-data type', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments.replace('goodtwo.mp3', 'goodtwo'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace(/people/g, 'goodtwo'))
              .expect(200))
            .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodtwo')
              .send({ dataset: true })
              .expect(400)
              .then(({ body }) => {
                body.message.should.be.equal('Dataset can only be linked to attachments with "Data File" type.');
              })))));

      it('should return error if dataset is not published', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.withAttachments)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity.replace(/people/g, 'goodone'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .send({ dataset: true })
          .expect(404);

      }));

    });

    describe('projects/:id/forms/:formId/draft/attachment/:name DELETE', () => {
      it('should unlink dataset from the form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace(/people/, 'goodone')))
            .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send({ dataset: true })
              .expect(200))
            .then(() => asAlice.delete('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/manifest')
              .set('X-OpenRosa-Version', '1.0')
              .expect(200)
              .then(({ text }) => {
                text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
  </manifest>`);
              })))));
    });

    describe('autolink dataset to attachments', () => {
      it('should set datasetId of attachment on form draft upload', testService((service, { Forms, FormAttachments }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() =>
                Forms.getByProjectAndXmlFormId(1, 'withAttachments', Form.DraftVersion)
                  .then(form => FormAttachments.getByFormDefIdAndName(form.get().def.id, 'people.csv')
                    .then(attachment => {
                      attachment.get().datasetId.should.not.be.null();
                    })))))));

      it.only('should not link dataset if previous version has blob', testService((service, { Forms, FormAttachments }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/people.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft')
              .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() =>
              Forms.getByProjectAndXmlFormId(1, 'withAttachments', Form.DraftVersion)
                .then(form => FormAttachments.getByFormDefIdAndName(form.get().def.id, 'people.csv')
                  .then(attachment => {
                    should(attachment.get().datasetId).be.null();
                    should(attachment.get().blobId).not.be.null();
                  }))))));

      it.only('should link dataset if previous version does not have blob or dataset linked', testService((service, { Forms, FormAttachments }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/people.csv')
              .send({ dataset: false })
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft')
              .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() =>
              Forms.getByProjectAndXmlFormId(1, 'withAttachments', Form.DraftVersion)
                .then(form => FormAttachments.getByFormDefIdAndName(form.get().def.id, 'people.csv')
                  .then(attachment => {
                    should(attachment.get().datasetId).not.be.null();
                    should(attachment.get().blobId).be.null();
                  }))))));

      // Verifying autolinking happens only for attachment with "file" type
      it.only('should not set datasetId of non-file type attachment', testService((service, { Forms, FormAttachments }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments.replace(/goodtwo.mp3/g, 'people'))
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() =>
                Forms.getByProjectAndXmlFormId(1, 'withAttachments', Form.AnyVersion)
                  .then(form => FormAttachments.getByFormDefIdAndName(form.get().def.id, 'people')
                    .then(attachment => {
                      should(attachment.get().datasetId).be.null();
                    })))))));

      describe('autolink when publishing form that creates and consumes new dataset', () => {
        // update form that consumes dataset
        const updateForm = `<?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
          <h:head>
            <model entities:entities-version="2024.1.0">
              <instance>
                <data id="updateEntity" orx:version="1.0">
                  <person/>
                  <name/>
                  <age/>
                  <hometown/>
                  <meta>
                    <entity dataset="people" id="" update="" baseVersion="" trunkVersion="" branchId="">
                      <label/>
                    </entity>
                  </meta>
                </data>
              </instance>
              <instance id="people" src="jr://file-csv/people.csv"/>
              <bind nodeset="/data/name" type="string" entities:saveto="first_name"/>
              <bind nodeset="/data/age" type="int" entities:saveto="age"/>
            </model>
          </h:head>
        </h:html>`;

        it('should autolink on upload new form and simultaneously publish', testService(async (service) => {
          const asAlice = await service.login('alice');

          await asAlice.post('/v1/projects/1/forms?publish=true')
            .send(updateForm)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.get('/v1/projects/1/forms/updateEntity/attachments')
            .then(({ body }) => {
              body[0].should.be.a.FormAttachment();
              body[0].name.should.equal('people.csv');
              body[0].datasetExists.should.be.true();
            });
        }));

        it('should autolink when first publishing a draft', testService(async (service) => {
          const asAlice = await service.login('alice');

          await asAlice.post('/v1/projects/1/forms')
            .send(updateForm)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms/updateEntity/draft/publish')
            .expect(200);

          await asAlice.get('/v1/projects/1/forms/updateEntity/attachments')
            .then(({ body }) => {
              body[0].should.be.a.FormAttachment();
              body[0].name.should.equal('people.csv');
              body[0].exists.should.be.true();
              body[0].blobExists.should.be.false();
              body[0].datasetExists.should.be.true();
            });
        }));

        it('should not autolink if attachment already filled in', testService(async (service) => {
          const asAlice = await service.login('alice');

          await asAlice.post('/v1/projects/1/forms')
            .send(updateForm)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms/updateEntity/draft/attachments/people.csv')
            .send('test,csv\n1,2')
            .set('Content-Type', 'text/csv')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms/updateEntity/draft/publish')
            .expect(200);

          await asAlice.get('/v1/projects/1/forms/updateEntity/attachments')
            .then(({ body }) => {
              body[0].should.be.a.FormAttachment();
              body[0].name.should.equal('people.csv');
              body[0].exists.should.be.true();
              body[0].blobExists.should.be.true();
              body[0].datasetExists.should.be.false();
              body[0].updatedAt.should.not.be.null();
            });
        }));

        it('should not autolink if attachment isnt the dataset in question', testService(async (service) => {
          const asAlice = await service.login('alice');

          const differentDataset = `<?xml version="1.0"?>
          <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
            <h:head>
              <model entities:entities-version="2024.1.0">
                <instance>
                  <data id="updateEntity" orx:version="1.0">
                    <person/>
                    <name/>
                    <age/>
                    <hometown/>
                    <meta>
                      <entity dataset="students" id="" update="" baseVersion="" trunkVersion="" branchId="">
                        <label/>
                      </entity>
                    </meta>
                  </data>
                </instance>
                <instance id="people" src="jr://file-csv/people.csv"/>
                <bind nodeset="/data/name" type="string" entities:saveto="first_name"/>
                <bind nodeset="/data/age" type="int" entities:saveto="age"/>
              </model>
            </h:head>
          </h:html>`;

          await asAlice.post('/v1/projects/1/forms')
            .send(differentDataset)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms/updateEntity/draft/publish')
            .expect(200);

          await asAlice.get('/v1/projects/1/forms/updateEntity/attachments')
            .then(({ body }) => {
              body[0].should.be.a.FormAttachment();
              body[0].name.should.equal('people.csv');
              body[0].exists.should.be.false();
              body[0].blobExists.should.be.false();
              body[0].datasetExists.should.be.false();
            });
        }));

        it('should not autolink if dataset already published because it will be attached already if dataset made before', testService(async (service) => {
          const asAlice = await service.login('alice');

          // upload form that makes people dataset already
          await asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms')
            .send(updateForm)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.get('/v1/projects/1/forms/updateEntity/draft/attachments')
            .then(({ body }) => {
              body[0].should.be.a.FormAttachment();
              body[0].name.should.equal('people.csv');
              body[0].exists.should.be.true();
              body[0].blobExists.should.be.false();
              body[0].datasetExists.should.be.true();
              body[0].should.not.have.property('updatedAt'); // linked to dataset when created, never updated
            });

          await asAlice.post('/v1/projects/1/forms/updateEntity/draft/publish')
            .expect(200);

          await asAlice.get('/v1/projects/1/forms/updateEntity/attachments')
            .then(({ body }) => {
              body[0].should.be.a.FormAttachment();
              body[0].name.should.equal('people.csv');
              body[0].exists.should.be.true();
              body[0].blobExists.should.be.false();
              body[0].datasetExists.should.be.true();
              body[0].should.not.have.property('updatedAt'); // linked to dataset when created, never updated
            });
        }));

        it('should autolink if dataset already published but it was created after the form draft', testService(async (service) => {
          const asAlice = await service.login('alice');

          await asAlice.post('/v1/projects/1/forms')
            .send(updateForm)
            .set('Content-Type', 'application/xml')
            .expect(200);

          // upload form that makes people dataset already
          await asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          // because the form was uploaded before the dataset was created, this will be null
          await asAlice.get('/v1/projects/1/forms/updateEntity/draft/attachments')
            .then(({ body }) => {
              body[0].should.be.a.FormAttachment();
              body[0].name.should.equal('people.csv');
              body[0].exists.should.be.false();
              body[0].blobExists.should.be.false();
              body[0].datasetExists.should.be.false();
            });

          // we DO auto-link here but since a Central user can still see the draft, and could
          // potentially see the new dataset now, we might want to change this behavior to NOT
          // auto-link and have the user explicitly link it themselves.
          await asAlice.post('/v1/projects/1/forms/updateEntity/draft/publish')
            .expect(200);

          await asAlice.get('/v1/projects/1/forms/updateEntity/attachments')
            .then(({ body }) => {
              body[0].should.be.a.FormAttachment();
              body[0].name.should.equal('people.csv');
              body[0].exists.should.be.true();
              body[0].blobExists.should.be.false();
              body[0].datasetExists.should.be.true();
            });
        }));

        it('should not autolink if the update form doesnt consume dataset', testService(async (service) => {
          const asAlice = await service.login('alice');

          // this form creates a dataset to update but it's not propertly attached to the form
          await asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.updateEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms/updateEntity/draft/publish')
            .expect(200);

          await asAlice.get('/v1/projects/1/forms/updateEntity/attachments')
            .then(({ body }) => {
              body.length.should.equal(0);
            });

          await asAlice.get('/v1/projects/1/datasets/people')
            .set('X-Extended-Metadata', 'true')
            .expect(200)
            .then(({ body }) => {
              body.linkedForms.length.should.equal(0);
            });
        }));

        it('should not autolink if form doesnt create dataset', testService(async (service) => {
          const asAlice = await service.login('alice');

          const noDataset = `<?xml version="1.0"?>
          <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
            <h:head>
              <model entities:entities-version="2024.1.0">
                <instance>
                  <data id="updateEntity" orx:version="1.0">
                    <person/>
                    <name/>
                    <age/>
                    <hometown/>
                    <meta>
                      <instanceID/>
                    </meta>
                  </data>
                </instance>
                <instance id="people" src="jr://file-csv/people.csv"/>
                <bind nodeset="/data/name" type="string" entities:saveto="first_name"/>
                <bind nodeset="/data/age" type="int" entities:saveto="age"/>
              </model>
            </h:head>
          </h:html>`;

          await asAlice.post('/v1/projects/1/forms')
            .send(noDataset)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms/updateEntity/draft/publish')
            .expect(200);

          await asAlice.get('/v1/projects/1/forms/updateEntity/attachments')
            .then(({ body }) => {
              body[0].should.be.a.FormAttachment();
              body[0].name.should.equal('people.csv');
              body[0].exists.should.be.false();
              body[0].blobExists.should.be.false();
              body[0].datasetExists.should.be.false();
            });
        }));

        it('should not autolink on create/consume dataset if .csv extention doesnt match case', testService(async (service) => {
          // we probably want this to be case insensitive but that change will come later.
          const asAlice = await service.login('alice');

          const caseChange = `<?xml version="1.0"?>
          <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
            <h:head>
              <model entities:entities-version="2024.1.0">
                <instance>
                  <data id="updateEntity" orx:version="1.0">
                    <person/>
                    <name/>
                    <age/>
                    <hometown/>
                    <meta>
                      <entity dataset="people" id="" update="" baseVersion="" trunkVersion="" branchId="">
                        <label/>
                      </entity>
                    </meta>
                  </data>
                </instance>
                <instance id="people" src="jr://file-csv/people.CSV"/>
                <bind nodeset="/data/name" type="string" entities:saveto="first_name"/>
                <bind nodeset="/data/age" type="int" entities:saveto="age"/>
              </model>
            </h:head>
          </h:html>`;

          await asAlice.post('/v1/projects/1/forms')
            .send(caseChange)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms/updateEntity/draft/publish')
            .expect(200);

          await asAlice.get('/v1/projects/1/forms/updateEntity/attachments')
            .then(({ body }) => {
              body[0].should.be.a.FormAttachment();
              body[0].name.should.equal('people.CSV');
              body[0].exists.should.be.false();
              body[0].blobExists.should.be.false();
              body[0].datasetExists.should.be.false();
            });
        }));

        it('should not autolink on draft consume-only form if .csv extention doesnt match case', testService(async (service) => {
          const asAlice = await service.login('alice');

          // upload form that makes people dataset already
          await asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          const caseChange = `<?xml version="1.0"?>
            <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
              <h:head>
                <model entities:entities-version="2024.1.0">
                  <instance>
                    <data id="updateEntity" orx:version="1.0">
                      <person/>
                      <name/>
                      <age/>
                      <hometown/>
                      <meta>
                        <instanceID/>
                      </meta>
                    </data>
                  </instance>
                  <instance id="people" src="jr://file-csv/people.CSV"/>
                  <bind nodeset="/data/name" type="string" entities:saveto="first_name"/>
                  <bind nodeset="/data/age" type="int" entities:saveto="age"/>
                </model>
              </h:head>
            </h:html>`;

          await asAlice.post('/v1/projects/1/forms')
            .send(caseChange)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await asAlice.get('/v1/projects/1/forms/updateEntity/draft/attachments')
            .then(({ body }) => {
              body[0].should.be.a.FormAttachment();
              body[0].name.should.equal('people.CSV');
              body[0].exists.should.be.false();
              body[0].blobExists.should.be.false();
              body[0].datasetExists.should.be.false();
            });
        }));
      });
    });

    // these scenario will never happen by just using APIs, adding following tests for safety
    describe('check datasetId constraints', () => {
      it.only('should throw problem if blobId and datasetId are being set', testService((service, { Forms, FormAttachments, Datasets }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace(/people/, 'goodone')))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => Promise.all([
              Forms.getByProjectAndXmlFormId(1, 'withAttachments', Form.DraftVersion).then((o) => o.get()),
              Datasets.get(1, 'goodone').then((o) => o.get())
            ]))
            .then(([form, dataset]) => FormAttachments.getByFormDefIdAndName(form.draftDefId, 'goodone.csv').then((o) => o.get())
              .then((attachment) => FormAttachments.update(form, attachment, 1, dataset.id)
                .catch(error => {
                  error.constraint.should.be.equal('check_blobId_or_datasetId_is_null');
                }))))));

      it.only('should throw problem if datasetId is being set for non-data type', testService((service, { Forms, FormAttachments, Datasets }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity))
            .then(() => Promise.all([
              Forms.getByProjectAndXmlFormId(1, 'withAttachments', Form.DraftVersion).then((o) => o.get()),
              Datasets.get(1, 'people').then((o) => o.get())
            ]))
            .then(([form, dataset]) => FormAttachments.getByFormDefIdAndName(form.draftDefId, 'goodtwo.mp3').then((o) => o.get())
              .then((attachment) => FormAttachments.update(form, attachment, null, dataset.id)
                .catch(error => {
                  error.constraint.should.be.equal('check_datasetId_is_null_for_non_file');
                }))))));

      // cb#673
      it('should not throw problem for fast external itemsets when there is existing "itemsets" dataset', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/people/, 'itemsets'))
          .expect(200);

        global.xlsformForm = 'itemsets';

        await asAlice.post('/v1/projects/1/forms')
          .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
          .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .set('X-XlsForm-FormId-Fallback', 'itemsets')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/itemsets/draft/attachments/itemsets.csv')
            .expect(200)
            .then(({ text }) => {
              text.should.equal('a,b,c\n1,2,3\n4,5,6');
            }));
      }));

      // cb#673
      it('should not throw problem for new version of "fast external itemsets" when there is existing "itemsets" dataset', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.itemsets)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/people/, 'itemsets'))
          .expect(200);

        // add external choice (fast external itemsets) to an existing form
        global.xlsformForm = 'itemsets';

        await asAlice.post('/v1/projects/1/forms/itemsets/draft')
          .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
          .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .set('X-XlsForm-FormId-Fallback', 'itemsets')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/itemsets/draft/attachments/itemsets.csv')
            .expect(200)
            .then(({ text }) => {
              text.should.equal('a,b,c\n1,2,3\n4,5,6');
            }));

      }));

    });

    describe('projects/:id/forms/:formId/attachments/:name (entities dataset)', () => {

      const createBothForms = async (asAlice) => {
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/people/g, 'goodone'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.withAttachments)
          .set('Content-Type', 'application/xml')
          .expect(200);
      };

      it('should return entities csv', testService((service, container) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace(/people/g, 'goodone'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
              .send(testData.instances.simpleEntity.one.replace(/people/g, 'goodone'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => exhaust(container))
            .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send({ dataset: true })
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
              .expect(200)
              .then(({ headers, text }) => {
                headers['content-disposition'].should.equal('attachment; filename="goodone.csv"; filename*=UTF-8\'\'goodone.csv');
                headers['content-type'].should.equal('text/csv; charset=utf-8');
                text.should.equal('name,label,__version,first_name,age\n12345678-1234-4123-8234-123456789abc,Alice (88),1,Alice,88\n');
              })))));

      it('should return entities csv for testing', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await createBothForms(asAlice);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one.replace(/people/g, 'goodone'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        const token = await asAlice.get('/v1/projects/1/forms/withAttachments/draft')
          .expect(200)
          .then(({ body }) => body.draftToken);

        await service.get(`/v1/test/${token}/projects/1/forms/withAttachments/draft/attachments/goodone.csv`)
          .expect(200)
          .then(({ text }) => { text.should.equal('name,label,__version,first_name,age\n12345678-1234-4123-8234-123456789abc,Alice (88),1,Alice,88\n'); });

      }));

      it('should return data for columns that contain valid special characters', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity
            .replace(/people/g, 'goodone')
            .replace(/age/g, 'the.age'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one
            .replace(/people/g, 'goodone')
            .replace(/age/g, 'the.age'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);


        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.withAttachments)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .expect(200)
          .then(({ text }) => {
            text.should.equal('name,label,__version,first_name,the.age\n' +
              '12345678-1234-4123-8234-123456789abc,Alice (88),1,Alice,88\n');
          });

      }));

      it('should not return deleted entities', testService(async (service) => {
        const asAlice = await service.login('alice');

        await createBothForms(asAlice);

        await asAlice.post('/v1/projects/1/datasets/goodone/entities')
          .send({
            uuid: '12345678-1234-4123-8234-111111111aaa',
            label: 'Johnny Doe',
            data: { first_name: 'Johnny', age: '22' }
          })
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/goodone/entities')
          .send({
            uuid: '12345678-1234-4123-8234-111111111bbb',
            label: 'Robert Doe',
            data: { first_name: 'Robert', age: '88' }
          })
          .expect(200);

        await asAlice.delete('/v1/projects/1/datasets/goodone/entities/12345678-1234-4123-8234-111111111bbb');

        const result = await asAlice.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
          .expect(200)
          .then(r => r.text);

        result.should.not.match(/Robert Doe/);

      }));

      it('should return updated value correctly', testService(async (service) => {
        const asAlice = await service.login('alice');

        await createBothForms(asAlice);

        await asAlice.post('/v1/projects/1/datasets/goodone/entities')
          .send({
            uuid: '12345678-1234-4123-8234-111111111aaa',
            label: 'Johnny Doe',
            data: { first_name: 'Johnny', age: '22' }
          })
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/goodone/entities/12345678-1234-4123-8234-111111111aaa?force=true')
          .send({
            data: { first_name: 'Robert', age: '' },
            label: 'Robert Doe (expired)'
          })
          .expect(200);

        const result = await asAlice.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
          .expect(200)
          .then(r => r.text);

        result.should.be.eql(
          'name,label,__version,first_name,age\n' +
          '12345678-1234-4123-8234-111111111aaa,Robert Doe (expired),2,Robert,\n'
        );

      }));

      it('should return md5 of last Entity timestamp in the manifest', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        const result = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .expect(200);

        const etag = result.get('ETag');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/forms/withAttachments/manifest')
          .set('X-OpenRosa-Version', '1.0')
          .expect(200)
          .then(({ text }) => {
            const domain = config.get('default.env.domain');
            text.should.be.eql(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
    <mediaFile type="entityList">
      <filename>people.csv</filename>
      <hash>md5:${etag.replace(/"/g, '')}</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withAttachments/attachments/people.csv</downloadUrl>
      <integrityUrl>${domain}/v1/projects/1/datasets/people/integrity</integrityUrl>
    </mediaFile>
  </manifest>`);
          });

      }));

      it('should return approvalEntityList as the type attribute of mediaFile for datasets that require approval', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/datasets')
          .send({ name: 'people', approvalRequired: true })
          .expect(200);

        const result = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .expect(200);

        const etag = result.get('ETag');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/forms/withAttachments/manifest')
          .set('X-OpenRosa-Version', '1.0')
          .expect(200)
          .then(({ text }) => {
            const domain = config.get('default.env.domain');
            text.should.be.eql(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
    <mediaFile type="approvalEntityList">
      <filename>people.csv</filename>
      <hash>md5:${etag.replace(/"/g, '')}</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withAttachments/attachments/people.csv</downloadUrl>
      <integrityUrl>${domain}/v1/projects/1/datasets/people/integrity</integrityUrl>
    </mediaFile>
  </manifest>`);
          });

      }));

      it('should return 304 content not changed if ETag matches', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        const result = await asAlice.get('/v1/projects/1/forms/withAttachments/attachments/people.csv')
          .expect(200);

        result.text.should.be.eql(
          'name,label,__version,first_name,age\n' +
          '12345678-1234-4123-8234-123456789abc,Alice (88),1,Alice,88\n'
        );

        const etag = result.get('ETag');

        await asAlice.get('/v1/projects/1/forms/withAttachments/attachments/people.csv')
          .set('If-None-Match', etag)
          .expect(304);

      }));

      it('should return ETag if content has changed', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        const result = await asAlice.get('/v1/projects/1/forms/withAttachments/attachments/people.csv')
          .expect(200);

        result.text.should.be.eql(
          'name,label,__version,first_name,age\n' +
          '12345678-1234-4123-8234-123456789abc,Alice (88),1,Alice,88\n'
        );

        const etag = result.get('ETag');

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
          .send({ data: { age: '33' } })
          .expect(200);

        await asAlice.get('/v1/projects/1/forms/withAttachments/attachments/people.csv')
          .set('If-None-Match', etag)
          .expect(200); // Not 304, content HAS been modified
      }));

      it('should return new ETag if content has been deleted', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.two)
          .set('Content-Type', 'application/xml')
          .expect(200);


        await exhaust(container);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        const result = await asAlice.get('/v1/projects/1/forms/withAttachments/attachments/people.csv')
          .expect(200);

        result.text.should.be.eql(
          'name,label,__version,first_name,age\n' +
          '12345678-1234-4123-8234-123456789aaa,Jane (30),1,Jane,30\n' +
          '12345678-1234-4123-8234-123456789abc,Alice (88),1,Alice,88\n'
        );

        const etag = result.get('ETag');

        await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200);

        await asAlice.get('/v1/projects/1/forms/withAttachments/attachments/people.csv')
          .set('If-None-Match', etag)
          .expect(200); // Not 304, content HAS been modified
      }));
    });
  });

  describe('dataset diffs', () => {
    describe('/projects/:id/forms/:formId/draft/dataset-diff GET', () => {

      it('should reject dataset-diff if the user cannot modify the form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
                .expect(403))))));

      it('should reject if user can modify form but not list datasets on project', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.get('/v1/users/current')
                .expect(200)
                .then(({ body }) => body)))
            .then((chelsea) =>
              asAlice.post(`/v1/projects/1/forms/simpleEntity/assignments/manager/${chelsea.id}`)
                .expect(200))
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
                .expect(403))))));

      it('should return all properties of dataset', testService(async (service) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
              .expect(200)
              .then(({ body }) => {
                body.should.be.eql([
                  {
                    name: 'people',
                    isNew: true,
                    properties: [
                      { name: 'first_name', isNew: true, inForm: true },
                      { name: 'age', isNew: true, inForm: true }
                    ]
                  }
                ]);
              })));
      }));

      it('should return all properties with isNew to be false', testService(async (service) => {
        // Upload a form and then create a new draft version
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.simpleEntity.replace(/simpleEntity/, 'simpleEntity2'))
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity2/draft/dataset-diff')
                .expect(200)
                .then(({ body }) => {
                  body.should.be.eql([
                    {
                      name: 'people',
                      isNew: false,
                      properties: [
                        { name: 'first_name', isNew: false, inForm: true },
                        { name: 'age', isNew: false, inForm: true }
                      ]
                    }
                  ]);
                }))));
      }));

      it('should return all properties with appropriate value of isNew', testService(async (service) => {
        // Upload a form and then create a new draft version
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.simpleEntity
                .replace(/simpleEntity/, 'simpleEntity2')
                .replace(/saveto="first_name"/, 'saveto="lastName"'))
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity2/draft/dataset-diff')
                .expect(200)
                .then(({ body }) => {
                  body.should.be.eql([{
                    name: 'people',
                    isNew: false,
                    properties: [
                      { name: 'first_name', isNew: false, inForm: false },
                      { name: 'lastName', isNew: true, inForm: true },
                      { name: 'age', isNew: false, inForm: true }
                    ]
                  }]);
                }))));
      }));

      it('should return properties in the same order they appear as questions in the form', testService(async (service) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.multiPropertyEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/multiPropertyEntity/draft/dataset-diff')
              .expect(200)
              .then(({ body }) => {
                body.should.be.eql([
                  {
                    name: 'foo',
                    isNew: true,
                    properties: [
                      { name: 'b_q1', isNew: true, inForm: true },
                      { name: 'd_q2', isNew: true, inForm: true },
                      { name: 'a_q3', isNew: true, inForm: true },
                      { name: 'c_q4', isNew: true, inForm: true }
                    ]
                  }
                ]);
              })));
      }));

      it('should return ordered properties including properties not in the form', testService(async (service) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.multiPropertyEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/multiPropertyEntity/draft')
              .send(testData.forms.multiPropertyEntity
                .replace('orx:version="1.0"', 'orx:version="2.0"') // update version
                .replace('entities:saveto="b_q1"', '') // remove q1 bind from form
                .replace('entities:saveto="a_q3"', 'entities:saveto="x_q3"')) // change q3 bind
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/multiPropertyEntity/draft/dataset-diff')
              .expect(200)
              .then(({ body }) => {
                body.should.be.eql([
                  {
                    name: 'foo',
                    isNew: false,
                    properties: [
                      { name: 'b_q1', isNew: false, inForm: false },
                      { name: 'a_q3', isNew: false, inForm: false },
                      { name: 'd_q2', isNew: false, inForm: true },
                      { name: 'x_q3', isNew: true, inForm: true },
                      { name: 'c_q4', isNew: false, inForm: true }
                    ]
                  }
                ]);
              })));
      }));

      it('should return dataset name only if no property mapping is defined', testService(async (service) => {
        // Upload a form and then create a new draft version
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity.replace(/entities:saveto="\w+"/g, ''))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
              .expect(200)
              .then(({ body }) => {
                body.should.be.eql([{
                  name: 'people',
                  isNew: true,
                  properties: []
                }]);
              })));
      }));

      it('should return empty array if there is no dataset defined', testService(async (service) => {
        // Upload a form and then create a new draft version
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simple.replace(/simple/, 'simple2'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple2/draft/dataset-diff')
              .expect(200)
              .then(({ body }) => {
                body.should.be.eql([]);
              })));
      }));

      it('should return only properties of the dataset of the requested project', testService(async (service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects')
              .set('Content-Type', 'application/json')
              .send({ name: 'Second Project' })
              .expect(200)
              .then(({ body }) =>
                asAlice.post(`/v1/projects/${body.id}/forms`)
                  .send(testData.forms.simpleEntity.replace(/age/g, 'email'))
                  .set('Content-Type', 'application/xml')
                  .expect(200))
              .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
                .expect(200)
                .then(({ body }) =>
                  body.should.be.eql([
                    {
                      name: 'people',
                      isNew: true,
                      properties: [
                        { name: 'first_name', isNew: true, inForm: true },
                        { name: 'age', isNew: true, inForm: true }
                      ]
                    }])))))));

      it('should return inForm false for removed property', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simpleEntity)
          .expect(200);

        // Let's create a draft without age property in dataset
        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simpleEntity
            .replace('entities:saveto="age"', ''))
          .expect(200);

        // Verify age.inForm should be false
        await asAlice.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
          .expect(200)
          .then(({ body }) => {
            body.should.be.eql([{
              name: 'people',
              isNew: false,
              properties: [
                { name: 'age', isNew: false, inForm: false },
                { name: 'first_name', isNew: false, inForm: true }
              ]
            }]);
          });
      }));

      it('should return empty array if managed encryption is enabled', testService(async (service) => {
        // Upload a form and then create a new draft version
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret' })
          .expect(200);

        await asAlice.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
          .expect(200)
          .then(({ body }) => {
            body.should.be.eql([]);
          });
      }));

      it('should return empty array if form is encrypted', testService(async (service) => {
        // Upload a form and then create a new draft version
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity.replace('</model>', '<submission base64RsaPublicKey="abc"/></model>'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
          .expect(200)
          .then(({ body }) => {
            body.should.be.eql([]);
          });
      }));
    });

    describe('/projects/:id/forms/:formId/dataset-diff GET', () => {
      it('should return all properties of dataset', testService(async (service) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity/dataset-diff')
              .expect(200)
              .then(({ body }) => {
                body.should.be.eql([
                  {
                    name: 'people',
                    properties: [
                      { name: 'first_name', inForm: true },
                      { name: 'age', inForm: true }
                    ]
                  }
                ]);
              })));
      }));

      it('should return all properties with appropriate value of inForm', testService(async (service) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity
                .replace(/simpleEntity/, 'simpleEntity2')
                .replace(/saveto="first_name"/, 'saveto="last_name"'))
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity2/dataset-diff')
                .expect(200)
                .then(({ body }) => {
                  body.should.be.eql([{
                    name: 'people',
                    properties: [
                      { name: 'first_name', inForm: false },
                      { name: 'last_name', inForm: true },
                      { name: 'age', inForm: true }
                    ]
                  }]);
                }))));
      }));

      it('should not return unpublished properties', testService(async (service) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.simpleEntity
                .replace(/simpleEntity/, 'simpleEntity2')
                .replace(/saveto="first_name"/, 'saveto="last_name"'))
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity/dataset-diff')
                .expect(200)
                .then(({ body }) => {
                  body.should.be.eql([{
                    name: 'people',
                    properties: [
                      { name: 'first_name', inForm: true },
                      { name: 'age', inForm: true }
                    ]
                  }]);
                }))));
      }));

      it('should return dataset name only if there is no properties', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/entities:saveto[^/]+/g, ''))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/forms/simpleEntity/dataset-diff')
          .expect(200)
          .then(({ body }) => {
            body.should.be.eql([{
              name: 'people',
              properties: []
            }]);
          });

      }));

      it('should let the user download even if there are no properties', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/entities:saveto[^/]+/g, ''))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .expect(200)
          .then(({ text }) => {
            text.should.equal('__id,label,__createdAt,__creatorId,__creatorName,__updates,__updatedAt,__version\n');
          });
      }));

    });
  });

  describe('parsing datasets on form upload', () => {
    describe('parsing datasets at /projects/:id/forms POST', () => {

      describe('warnings about entities-version from before 2024.1.0', () => {
        it('should warn if the entities-version is 2022.1.0 (earlier than 2024.1.0)', testService(async (service) => {
          const asAlice = await service.login('alice');

          await asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity2022)
            .set('Content-Type', 'application/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.be.eql(400.16);
              body.details.warnings.workflowWarnings[0].should.be.eql({
                type: 'oldEntityVersion',
                details: { version: '2022.1.0' },
                reason: 'Entities specification version [2022.1.0] is not compatible with Offline Entities. Please use version 2024.1.0 or later.'
              });
            });

          await asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
            .send(testData.forms.simpleEntity2022)
            .set('Content-Type', 'application/xml')
            .expect(200);
        }));

        it('should warn if the entities-version is 2023.1.0 (earlier than 2024.1.0)', testService(async (service) => {
          const asAlice = await service.login('alice');

          await asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.updateEntity2023)
            .set('Content-Type', 'application/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.be.eql(400.16);
              body.details.warnings.workflowWarnings[0].should.be.eql({
                type: 'oldEntityVersion',
                details: { version: '2023.1.0' },
                reason: 'Entities specification version [2023.1.0] is not compatible with Offline Entities. Please use version 2024.1.0 or later.'
              });
            });

          await asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
            .send(testData.forms.updateEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);
        }));
      });

      it('should return a Problem if the entity xml has the wrong version', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity.replace('2024.1.0', 'bad-version'))
            .set('Content-Type', 'text/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.25);
              body.details.reason.should.equal('Entities specification version [bad-version] is not supported.');
            }))));

      it('should return a Problem if the entity xml is invalid (e.g. missing dataset name)', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity.replace('dataset="people"', ''))
            .set('Content-Type', 'text/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.25);
              body.details.reason.should.equal('Dataset name is missing.');
            }))));

      it('should return a Problem if the savetos reference invalid properties', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity.replace('first_name', 'name'))
            .set('Content-Type', 'text/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.25);
              body.details.reason.should.equal('Invalid entity property name.');
            }))));

      it('should return a Problem if the savetos reference invalid properties (extra whitespace)', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity.replace('first_name', '  first_name  '))
            .set('Content-Type', 'text/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.25);
              body.details.reason.should.equal('Invalid entity property name.');
            }))));

      it('should return the created form upon success', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.Form();
              body.xmlFormId.should.equal('simpleEntity');

              return asAlice.get('/v1/projects/1/forms/simpleEntity/draft')
                .set('X-Extended-Metadata', 'true')
                .expect(200)
                .then(({ body: getBody }) => {
                  getBody.should.be.a.Form();
                  getBody.entityRelated.should.equal(true);
                });
            }))));

      it('should accept entity form and save dataset with no binds', testService((service) => {
        const xml = `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
        <h:head>
          <h:title>nobinds</h:title>
          <model entities:entities-version='2024.1.0'>
            <instance>
              <data id="nobinds">
                <name/>
                <age/>
                <meta>
                  <entity dataset="something" id="" create="1">
                    <label/>
                  </entity>
                </meta>
              </data>
            </instance>
          </model>
        </h:head>
      </h:html>`;
        return service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(xml)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.Form();
              body.xmlFormId.should.equal('nobinds');
            }));
      }));

      it('should not let multiple fields to be mapped to a single property', testService(async (service) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity.replace(/first_name/g, 'age'))
            .set('Content-Type', 'application/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.be.eql(400.25);
              body.message.should.be.eql('The entity definition within the form is invalid. Multiple Form Fields cannot be saved to a single property.');
            }));
      }));

      it('should ignore a saveto incorrrectly placed on a bind on a structural field', testService(async (service) => {
        const alice = await service.login('alice');
        const xml = `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
          <h:head>
            <model entities:entities-version='2024.1.0'>
              <instance>
                <data id="validate_structure">
                  <name/>
                  <age/>
                  <group>
                    <inner_field/>
                  </group>
                  <meta>
                    <entity dataset="things" id="" create="1">
                      <label/>
                    </entity>
                  </meta>
                </data>
              </instance>
              <bind nodeset="/data/name" type="string" entities:saveto="prop1"/>
              <bind nodeset="/data/group" entities:saveto="prop2"/>
              <bind nodeset="/data/group/inner_field" type="string" entities:saveto="prop3"/>
            </model>
          </h:head>
        </h:html>`;
        await alice.post('/v1/projects/1/forms')
          .send(xml)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await alice.get('/v1/projects/1/forms/validate_structure/draft/dataset-diff')
          .expect(200)
          .then(({ body }) => {
            const { properties } = body[0];
            properties.length.should.equal(2);
            properties[0].name.should.equal('prop1');
            properties[1].name.should.equal('prop3');
          });
        await alice.post('/v1/projects/1/forms/validate_structure/draft/publish')
          .expect(200);
        await alice.get('/v1/projects/1/datasets/things')
          .expect(200)
          .then(({ body }) => {
            body.name.should.be.eql('things');
            const { properties } = body;
            properties.length.should.equal(2);
            properties[0].name.should.equal('prop1');
            properties[1].name.should.equal('prop3');
          });
      }));

      it('should throw an error when a saveto is on a field inside a repeat group', testService(async (service) => {
        // Entities made from repeat groups are not yet supported. pyxform also throws an error about this.
        const form = `<?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:entities="http://www.opendatakit.org/xforms/entities" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:orx="http://openrosa.org/xforms" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
          <h:head>
            <h:title>Repeat Children Entities</h:title>
            <model entities:entities-version="2024.1.0" odk:xforms-version="1.0.0">
              <instance>
                <data id="repeat_entity" version="2">
                  <num_children/>
                  <child>
                    <child_name/>
                  </child>
                  <meta>
                    <instanceID/>
                    <instanceName/>
                    <entity create="1" dataset="children" id="">
                      <label/>
                    </entity>
                  </meta>
                </data>
              </instance>
              <bind entities:saveto="num_children" nodeset="/data/num_children" type="int"/>
              <bind entities:saveto="child_name" nodeset="/data/child/child_name" type="string"/>
              <bind jr:preload="uid" nodeset="/data/meta/instanceID" readonly="true()" type="string"/>
              <bind calculate=" /data/num_children " nodeset="/data/meta/instanceName" type="string"/>
              <bind calculate="1" nodeset="/data/meta/entity/@create" readonly="true()" type="string"/>
              <bind nodeset="/data/meta/entity/@id" readonly="true()" type="string"/>
              <setvalue event="odk-instance-first-load" readonly="true()" ref="/data/meta/entity/@id" type="string" value="uuid()"/>
              <bind calculate="concat(&quot;Num children:&quot;,  /data/num_children )" nodeset="/data/meta/entity/label" readonly="true()" type="string"/>
            </model>
          </h:head>
          <h:body>
            <input ref="/data/num_children">
              <label>Num Children</label>
            </input>
            <group ref="/data/child">
              <label>Child</label>
              <repeat nodeset="/data/child">
                <input ref="/data/child/child_name">
                  <label>Child Name</label>
                </input>
              </repeat>
            </group>
          </h:body>
        </h:html>
        `;
        const alice = await service.login('alice');
        await alice.post('/v1/projects/1/forms?publish=true')
          .send(form)
          .set('Content-Type', 'application/xml')
          .expect(400)
          .then(({ body }) => {
            body.code.should.equal(400.25);
            body.details.reason.should.equal('Currently, entities cannot be populated from fields in repeat groups.');
          });
      }));

      it('should publish dataset when any dataset creating form is published', testService(async (service) => {
        const alice = await service.login('alice');

        await alice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await alice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/simpleEntity/g, 'simpleEntity2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await alice.get('/v1/projects/1/datasets')
          .expect(200)
          .then(({ body }) => {
            body[0].name.should.be.eql('people');
          });

        await alice.get('/v1/projects/1/datasets/people')
          .expect(200)
          .then(({ body }) => {
            body.name.should.be.eql('people');
          });

      }));

      describe('dataset name conflicts via Form upload and publishing', () => {
        it('should allow two forms to refrence the same dataset if the case is exactly the same', testService(async (service) => {
          const alice = await service.login('alice');

          // dataset "people"
          await alice.post('/v1/projects/1/forms?publish=True')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          // also dataset "people"
          await alice.post('/v1/projects/1/forms?publish=True')
            .send(testData.forms.simpleEntity
              .replace(/simpleEntity/g, 'simpleEntity2'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          await alice.get('/v1/projects/1/datasets')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].name.should.equal('people');
            });
        }));

        it('should not allow a form to be uploaded if dataset name conflicts with existing published dataset', testService(async (service) => {
          const alice = await service.login('alice');

          // dataset "people"
          await alice.post('/v1/projects/1/forms?publish=True')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          // dataset "PEOPLE"
          await alice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity
              .replace('dataset="people"', 'dataset="PEOPLE"')
              .replace(/simpleEntity/g, 'simpleEntity2'))
            .set('Content-Type', 'application/xml')
            .expect(409)
            .then(({ body }) => {
              body.code.should.equal(409.16);
              body.message.should.startWith("A dataset named 'people' exists and you provided 'PEOPLE'");
            });

          // dataset "People", should not work to auto-publish form either
          await alice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity
              .replace('dataset="people"', 'dataset="People"')
              .replace(/simpleEntity/g, 'simpleEntity3'))
            .set('Content-Type', 'application/xml')
            .expect(409)
            .then(({ body }) => {
              body.code.should.equal(409.16);
              body.message.should.startWith("A dataset named 'people' exists and you provided 'People'");
            });
        }));

        it('should not allow the second form to publish a dataset that will have a name conflict', testService(async (service) => {
          const alice = await service.login('alice');

          // dataset "people"
          await alice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          // dataset "PEOPLE"
          await alice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity
              .replace('dataset="people"', 'dataset="PEOPLE"')
              .replace(/simpleEntity/g, 'simpleEntity2'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          await alice.post('/v1/projects/1/forms/simpleEntity/draft/publish')
            .expect(200);

          await alice.post('/v1/projects/1/forms/simpleEntity2/draft/publish')
            .expect(409)
            .then(({ body }) => {
              body.code.should.equal(409.16);
              body.message.should.startWith("A dataset named 'people' exists and you provided 'PEOPLE'");
            });
        }));

        it('should not allow the second form to publish (with new version) a dataset that will have a name conflict', testService(async (service) => {
          const alice = await service.login('alice');

          // dataset "people"
          await alice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          // dataset "PEOPLE"
          await alice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity
              .replace('dataset="people"', 'dataset="PEOPLE"')
              .replace(/simpleEntity/g, 'simpleEntity2'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          await alice.post('/v1/projects/1/forms/simpleEntity/draft/publish')
            .expect(200);

          await alice.post('/v1/projects/1/forms/simpleEntity2/draft/publish?version=123')
            .expect(409)
            .then(({ body }) => {
              body.code.should.equal(409.16);
              body.message.should.startWith("A dataset named 'people' exists and you provided 'PEOPLE'");
            });
        }));

        it('should prevent name conflicts when there are multiple draft datasets with different capitalization', testService(async (service) => {
          const alice = await service.login('alice');

          // dataset "people"
          await alice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          // dataset "PEOPLE"
          await alice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity
              .replace('dataset="people"', 'dataset="PEOPLE"')
              .replace(/simpleEntity/g, 'simpleEntity2'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          // dataset "People"
          await alice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity
              .replace('dataset="people"', 'dataset="People"')
              .replace(/simpleEntity/g, 'simpleEntity3'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          await alice.post('/v1/projects/1/forms/simpleEntity/draft/publish')
            .expect(200);

          // dataset "PeOpLe"
          await alice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity
              .replace('dataset="people"', 'dataset="PeOpLe"')
              .replace(/simpleEntity/g, 'simpleEntity4'))
            .set('Content-Type', 'application/xml')
            .expect(409)
            .then(({ body }) => {
              body.code.should.equal(409.16);
              body.message.should.startWith("A dataset named 'people' exists and you provided 'PeOpLe'");
            });

          await alice.post('/v1/projects/1/forms/simpleEntity2/draft/publish')
            .expect(409)
            .then(({ body }) => {
              body.code.should.equal(409.16);
              body.message.should.startWith("A dataset named 'people' exists and you provided 'PEOPLE'");
            });
        }));

        it('should allow forms that match exisitng datasets even when there are other drafts with different capitalizations', testService(async (service) => {
          const alice = await service.login('alice');

          // dataset "people"
          await alice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          // dataset "PEOPLE"
          await alice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity
              .replace('dataset="people"', 'dataset="PEOPLE"')
              .replace(/simpleEntity/g, 'simpleEntity2'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          // dataset "people" (same as first)
          await alice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity
              .replace('dataset="people"', 'dataset="people"')
              .replace(/simpleEntity/g, 'simpleEntity3'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          // publish "people"
          await alice.post('/v1/projects/1/forms/simpleEntity/draft/publish')
            .expect(200);

          // dataset "people" (same as first/published)
          await alice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity
              .replace(/simpleEntity/g, 'simpleEntity4'))
            .set('Content-Type', 'application/xml')
            .expect(200);
        }));

        it('should allow forms with same name in a different project to be published', testService(async (service) => {
          const alice = await service.login('alice');

          const newProjectId = await service.login('alice', (asAlice) =>
            asAlice.post('/v1/projects')
              .send({ name: 'Second Project' })
              .then(({ body }) => body.id));

          // dataset "people" in project 1
          await alice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          // dataset "people" in new project
          await alice.post(`/v1/projects/${newProjectId}/forms`)
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await alice.post(`/v1/projects/${newProjectId}/forms/simpleEntity/draft/publish`)
            .expect(200);
        }));
      });

      describe('dataset properties name conflicts via Form upload', () => {
        it('should reject if property name differ by just capitalization', testService(async (service) => {
          const alice = await service.login('alice');

          // dataset "people" with property "first_name"
          await alice.post('/v1/projects/1/forms?publish=True')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          // dataset "people" with property "FIRST_NAME"
          await alice.post('/v1/projects/1/forms?publish=True')
            .send(testData.forms.simpleEntity
              .replace(/simpleEntity/g, 'simpleEntity2')
              .replace('first_name', 'FIRST_NAME'))
            .set('Content-Type', 'application/xml')
            .expect(409)
            .then(({ body }) => {
              body.message.should.match(/This form attempts to create new Entity properties that match with existing ones except for capitalization/);
            });
        }));

        it('should reject when publishing duplicate property with different capitalization', testService(async (service) => {
          const alice = await service.login('alice');

          // dataset "people" with property "first_name" - draft only
          await alice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          // dataset "people" with property "FIRST_NAME" - published
          await alice.post('/v1/projects/1/forms?publish=True')
            .send(testData.forms.simpleEntity
              .replace(/simpleEntity/g, 'simpleEntity2')
              .replace('first_name', 'FIRST_NAME'))
            .set('Content-Type', 'application/xml')
            .expect(200);

          await alice.post('/v1/projects/1/forms/simpleEntity/draft/publish')
            .expect(409)
            .then(({ body }) => {
              body.message.should.match(/This form attempts to create new Entity properties that match with existing ones except for capitalization/);
            });
        }));

        it('should reject when new Form draft has duplicate property with different capitalization', testService(async (service) => {
          const alice = await service.login('alice');

          // dataset "people" with property "first_name"
          await alice.post('/v1/projects/1/forms?publish=True')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          // dataset "people" with property "FIRST_NAME" - draft
          await alice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity
              .replace(/simpleEntity/g, 'simpleEntity2')
              .replace('first_name', 'FIRST_NAME'))
            .set('Content-Type', 'application/xml')
            .expect(409)
            .then(({ body }) => {
              body.message.should.match(/This form attempts to create new Entity properties that match with existing ones except for capitalization/);
            });
        }));

        it('reject if the Form contains duplicate properties with different capitalization', testService(async (service) => {
          const alice = await service.login('alice');

          // dataset "people" with properties "age" and "AGE"
          await alice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity.replace('first_name', 'AGE'))
            .set('Content-Type', 'application/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.be.eql(400.25);
              body.message.should.be.eql('The entity definition within the form is invalid. Multiple Form Fields cannot be saved to a single property.');
            });

        }));

        it('should not reject for existing duplicate properties', testService(async (service, container) => {
          const alice = await service.login('alice');

          await alice.post('/v1/projects/1/forms?publish=True')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200);

          await container.run(sql`UPDATE ds_properties SET name='FIRST_NAME' WHERE name='age'`);

          await alice.post('/v1/projects/1/forms/simpleEntity/draft')
            .expect(200);

          await alice.post('/v1/projects/1/forms/simpleEntity/draft/publish?version=v2')
            .expect(200);
        }));
      });

      describe('updating datasets through new form drafts', () => {
        it('should update a dataset with a new draft and be able to upload multiple drafts', testService(async (service) => {
          const asAlice = await service.login('alice');

          // Upload a form and then create a new draft version
          await asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
                .send(testData.forms.simpleEntity)
                .set('Content-Type', 'application/xml')
                .expect(200))
              .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity/draft')
                .set('X-Extended-Metadata', 'true')
                .expect(200)
                .then(({ body }) => {
                  body.entityRelated.should.equal(true);
                })));

          await asAlice.get('/v1/projects/1/datasets')
            .expect(200)
            .then(({ body }) => {
              body[0].name.should.be.eql('people');
            });

          await asAlice.get('/v1/projects/1/datasets/people')
            .expect(200)
            .then(({ body }) => {
              body.name.should.be.eql('people');
              body.properties.length.should.be.eql(2);
            });
        }));

        it('should return a Problem if updated form has invalid dataset properties', testService(async (service) => {
          const asAlice = await service.login('alice');
          await asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
              .send(testData.forms.simpleEntity.replace('first_name', 'name'))
              .set('Content-Type', 'application/xml')
              .expect(400)
              .then(({ body }) => {
                body.code.should.equal(400.25);
                body.details.reason.should.equal('Invalid entity property name.');
              }));
        }));
      });

      describe('dataset-specific verbs', () => {
        describe('dataset.create', () => {
          it('should NOT allow a new form that creates a dataset without user having dataset.create verb', testServiceFullTrx(async (service, { run }) => {
            await run(sql`UPDATE roles SET verbs = (verbs - 'dataset.create') WHERE system in ('manager')`);

            const asBob = await service.login('bob');

            await asBob.post('/v1/projects/1/forms')
              .send(testData.forms.simpleEntity)
              .set('Content-Type', 'text/xml')
              .expect(403);

            // shouldn't work with immediate publish, either
            await asBob.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity)
              .set('Content-Type', 'text/xml')
              .expect(403);
          }));

          it('should NOT allow "creating" of a dataset when the dataset exists but unpublished', testServiceFullTrx(async (service, { run }) => {
            const asAlice = await service.login('alice');
            const asBob = await service.login('bob');
            await run(sql`UPDATE roles SET verbs = (verbs - 'dataset.create') WHERE system in ('manager')`);

            // Alice can upload first version of form that creates unpublished "people" dataset
            await asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.simpleEntity)
              .set('Content-Type', 'text/xml')
              .expect(200);

            // Should not be OK for bob to "create" people dataset
            await asBob.post('/v1/projects/1/forms')
              .send(testData.forms.simpleEntity
                .replace('simpleEntity', 'simpleEntity2'))
              .set('Content-Type', 'text/xml')
              .expect(403);
          }));

          it('should NOT allow updating a form about an unpublished dataset, which is similar to creating that dataset', testServiceFullTrx(async (service, { run }) => {
            const asAlice = await service.login('alice');
            const asBob = await service.login('bob');
            await run(sql`UPDATE roles SET verbs = (verbs - 'dataset.create') WHERE system in ('manager')`);

            // Alice can upload first version of form that creates unpublished "people" dataset
            await asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.simpleEntity)
              .set('Content-Type', 'text/xml')
              .expect(200);

            // Should not be OK for bob to update this form
            await asBob.post('/v1/projects/1/forms/simpleEntity/draft')
              .send(testData.forms.simpleEntity)
              .set('Content-Type', 'text/xml')
              .expect(403);
          }));

          it('should NOT allow updating a draft that creates a dataset without user having dataset.create verb', testServiceFullTrx(async (service, { run }) => {
            const asAlice = await service.login('alice');
            const asBob = await service.login('bob');
            await run(sql`UPDATE roles SET verbs = (verbs - 'dataset.create') WHERE system in ('manager')`);

            // Alice can upload first version of form
            await asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity)
              .set('Content-Type', 'text/xml')
              .expect(200);

            await asBob.post('/v1/projects/1/forms/simpleEntity/draft')
              .send(testData.forms.simpleEntity.replace(/people/g, 'trees'))
              .set('Content-Type', 'text/xml')
              .expect(403);
          }));

          it('should NOT allow unpublished dataset to be published on form publish if user does not have dataset.create verb', testServiceFullTrx(async (service, { run }) => {
            const asAlice = await service.login('alice');
            const asBob = await service.login('bob');
            await run(sql`UPDATE roles SET verbs = (verbs - 'dataset.create') WHERE system in ('manager')`);

            // Alice can upload first version of form
            await asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.simpleEntity)
              .set('Content-Type', 'text/xml')
              .expect(200);

            // Bob should not be able to publish form because it will publish the new dataset
            await asBob.post('/v1/projects/1/forms/simpleEntity/draft/publish')
              .expect(403);
          }));
        });

        describe('dataset.update', () => {
          it('should NOT allow a new form that updates a dataset without user having dataset.update verb', testServiceFullTrx(async (service, { run }) => {
            const asAlice = await service.login('alice');
            const asBob = await service.login('bob');

            await run(sql`UPDATE roles SET verbs = (verbs - 'dataset.update') WHERE system in ('manager')`);

            await asAlice.post('/v1/projects/1/datasets')
              .send({ name: 'people' })
              .expect(200);

            // Form mentions properties 'age' and 'first_name' in dataset 'people'
            // But Bob is not allowed to add these new properties to an existing dataset.
            await asBob.post('/v1/projects/1/forms')
              .send(testData.forms.simpleEntity)
              .set('Content-Type', 'text/xml')
              .expect(403);

            // shouldn't work with immediate publish, either
            await asBob.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity)
              .set('Content-Type', 'text/xml')
              .expect(403);
          }));

          it('should NOT allow update draft that updates a dataset without user having dataset.update verb', testServiceFullTrx(async (service, { run }) => {
            const asAlice = await service.login('alice');
            const asBob = await service.login('bob');
            await run(sql`UPDATE roles SET verbs = (verbs - 'dataset.update') WHERE system in ('manager')`);

            // Alice can upload first version of form
            await asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity)
              .set('Content-Type', 'text/xml')
              .expect(200);

            await asBob.post('/v1/projects/1/forms/simpleEntity/draft')
              .send(testData.forms.simpleEntity.replace('saveto="age"', 'saveto="birth_year"'))
              .set('Content-Type', 'text/xml')
              .expect(403);
          }));

          it('should NOT allow unpublished properties to be published on form publish if user does not have dataset.update verb', testServiceFullTrx(async (service, { run }) => {
            const asAlice = await service.login('alice');
            const asBob = await service.login('bob');
            await run(sql`UPDATE roles SET verbs = (verbs - 'dataset.update') WHERE system in ('manager')`);

            // Alice can upload and publish first version of form
            await asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity)
              .set('Content-Type', 'text/xml')
              .expect(200);

            // Alice can upload new version of form with new property
            await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
              .send(testData.forms.simpleEntity
                .replace('saveto="age"', 'saveto="birth_year"')
                .replace('orx:version="1.0"', 'orx:version="2.0"')
              )
              .set('Content-Type', 'text/xml')
              .expect(200);

            // Bob should not be able to publish form because it will publish the new property
            await asBob.post('/v1/projects/1/forms/simpleEntity/draft/publish')
              .expect(403);
          }));

          it('should ALLOW update of form draft that does not modify existing dataset', testServiceFullTrx(async (service, { run }) => {
            const asAlice = await service.login('alice');
            const asBob = await service.login('bob');
            await run(sql`UPDATE roles SET verbs = (verbs - 'dataset.update') WHERE system in ('manager')`);

            // Alice can upload first version of form
            await asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity)
              .set('Content-Type', 'text/xml')
              .expect(200);

            // Should be OK for bob to update draft if not updating dataset
            await asBob.post('/v1/projects/1/forms/simpleEntity/draft')
              .send(testData.forms.simpleEntity)
              .set('Content-Type', 'text/xml')
              .expect(200);
          }));

          it('should ALLOW new form about existing dataset that does not update it', testServiceFullTrx(async (service, { run }) => {
            const asAlice = await service.login('alice');
            const asBob = await service.login('bob');
            await run(sql`UPDATE roles SET verbs = (verbs - 'dataset.update') WHERE system in ('manager')`);

            // Alice can create the dataset
            await asAlice.post('/v1/projects/1/datasets')
              .send({ name: 'people' })
              .expect(200);

            // And create the properties
            await asAlice.post('/v1/projects/1/datasets/people/properties')
              .send({ name: 'age' })
              .expect(200);
            await asAlice.post('/v1/projects/1/datasets/people/properties')
              .send({ name: 'first_name' })
              .expect(200);

            // Should be OK for bob to upload form that uses existing dataset and properties
            await asBob.post('/v1/projects/1/forms')
              .send(testData.forms.simpleEntity)
              .set('Content-Type', 'text/xml')
              .expect(200);
          }));
        });
      });
    });

    describe('dataset audit logging at /projects/:id/forms POST', () => {
      it('should not log dataset creation when form is not published', testService(async (service, { Audits }) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'text/xml')
            .expect(200));

        const audit = await Audits.getLatestByAction('dataset.create');
        audit.should.equal(Option.none());
      }));

      it('should not log dataset modification when form is not published', testService(async (service, { Audits }) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.simpleEntity
                .replace('simpleEntity', 'simpleEntity2')
                .replace('first_name', 'color_name'))
              .set('Content-Type', 'text/xml')
              .expect(200)));

        const audit = await Audits.getLatestByAction('dataset.update');

        audit.should.equal(Option.none());
      }));

      it('should log appropriate sequence of form and dataset events', testService(async (service) => {

        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'text/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simpleEntity.replace('orx:version="1.0"', 'orx:version="draft1"').replace(/first_name/g, 'nickname'))
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft/publish');

        await asAlice.get('/v1/audits?action=nonverbose')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(7);
            body.map(a => a.action).should.eql([
              'form.update.publish',
              'dataset.update',
              'form.update.draft.set',
              'form.update.publish',
              'dataset.create',
              'form.create',
              'user.session.create'
            ]);
          });
      }));

      it('should not log dataset modification when no new property is added', testService(async (service, { Audits }) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'text/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft/publish?version=v2')
          .expect(200);

        const audit = await Audits.getLatestByAction('dataset.update');

        audit.should.equal(Option.none());
      }));

      it('should log dataset publishing with properties in audit log', testService(async (service, { Audits }) => {

        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'text/xml')
          .expect(200);

        await Audits.getLatestByAction('dataset.create')
          .then(o => o.get())
          .then(audit => audit.details.should.eql({ properties: ['first_name', 'age'] }));

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity
            .replace('simpleEntity', 'simpleEntity2')
            .replace('first_name', 'color_name'))
          .set('Content-Type', 'text/xml')
          .expect(200);

        await Audits.getLatestByAction('dataset.update')
          .then(o => o.get())
          .then(audit => audit.details.should.eql({ properties: ['first_name', 'age', 'color_name',] }));

      }));

      describe('uploading forms that UPDATE but do not create entities', () => {
        it('should be able to add properties to datasets', testService(async (service) => {
          const asAlice = await service.login('alice');
          await asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'text/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.updateEntity
              .replace('entities:saveto="first_name"', 'entities:saveto="nickname"'))
            .set('Content-Type', 'text/xml')
            .expect(200);

          await asAlice.get('/v1/projects/1/forms/updateEntity/draft/dataset-diff')
            .expect(200)
            .then(({ body }) => {
              body.should.be.eql([
                {
                  name: 'people',
                  isNew: false,
                  properties: [
                    { name: 'first_name', isNew: false, inForm: false },
                    { name: 'nickname', isNew: true, inForm: true },
                    { name: 'age', isNew: false, inForm: true }
                  ]
                }
              ]);
            });

          await asAlice.post('/v1/projects/1/forms/updateEntity/draft/publish');

          await asAlice.get('/v1/projects/1/forms/updateEntity/dataset-diff')
            .expect(200)
            .then(({ body }) => {
              body.should.be.eql([
                {
                  name: 'people',
                  properties: [
                    { name: 'first_name', inForm: false },
                    { name: 'nickname', inForm: true },
                    { name: 'age', inForm: true }
                  ]
                }
              ]);
            });
        }));

        it('should be able to have an update entity form with no savetos', testService(async (service) => {
          const asAlice = await service.login('alice');
          await asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'text/xml')
            .expect(200);

          await asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.updateEntity
              .replace('entities:saveto="first_name"', '')
              .replace('entities:saveto="age"', ''))
            .set('Content-Type', 'text/xml')
            .expect(200);

          await asAlice.get('/v1/projects/1/forms/updateEntity/draft/dataset-diff')
            .expect(200)
            .then(({ body }) => {
              body.should.be.eql([
                {
                  name: 'people',
                  isNew: false,
                  properties: [
                    { name: 'first_name', isNew: false, inForm: false },
                    { name: 'age', isNew: false, inForm: false }
                  ]
                }
              ]);
            });

          await asAlice.post('/v1/projects/1/forms/updateEntity/draft/publish');

          await asAlice.get('/v1/projects/1/forms/updateEntity/dataset-diff')
            .expect(200)
            .then(({ body }) => {
              body.should.be.eql([
                {
                  name: 'people',
                  properties: [
                    { name: 'first_name', inForm: false },
                    { name: 'age', inForm: false }
                  ]
                }
              ]);
            });
        }));

        it('should create dataset if it does not exist and and log it', testService(async (service) => {
          const asAlice = await service.login('alice');
          await asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.updateEntity)
            .set('Content-Type', 'text/xml')
            .expect(200);

          await asAlice.get('/v1/projects/1/forms/updateEntity/draft/dataset-diff')
            .expect(200)
            .then(({ body }) => {
              body.should.be.eql([
                {
                  name: 'people',
                  isNew: true, // Dataset is new
                  properties: [
                    { name: 'first_name', isNew: true, inForm: true },
                    { name: 'age', isNew: true, inForm: true }
                  ]
                }
              ]);
            });

          await asAlice.post('/v1/projects/1/forms/updateEntity/draft/publish');

          await asAlice.get('/v1/projects/1/datasets/people')
            .expect(200)
            .then(({ body }) => {
              body.name.should.be.eql('people');
              body.properties.map(p => p.name).should.eql(['first_name', 'age']);
            });

          await asAlice.get('/v1/audits?action=dataset.create')
            .expect(200)
            .then(({ body: audits }) => {
              audits[0].details.should.eql({ properties: ['first_name', 'age'] });
            });
        }));
      });
    });

    describe('dataset property interaction with intermediate form schemas and purging uneeded drafts', () => {
      it('should clean up form fields and dataset properties of unneeded drafts', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simpleEntity)
          .expect(200);

        // ignoring warning about removing a field
        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft?ignoreWarnings=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simpleEntity.replace('orx:version="1.0"', 'orx:version="draft1"').replace(/first_name/g, 'nickname'))
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simpleEntity.replace('orx:version="1.0"', 'orx:version="draft"'))
          .expect(200);

        // there are expected to be
        // 2 defs of this form (published and new draft)
        // 6 form fields of original form (and new form): 3 entity related fields and 3 question fields
        // ideally only 4 ds property fields, but 2 from deleted def are still there
        await Promise.all([
          container.oneFirst(sql`select count(*) from form_defs as fd join forms as f on fd."formId" = f.id where f."xmlFormId"='simpleEntity'`),
          container.oneFirst(sql`select count(*) from form_fields as fs join forms as f on fs."formId" = f.id where f."xmlFormId"='simpleEntity'`),
          container.oneFirst(sql`select count(*) from ds_property_fields`),
        ])
          .then((counts) => counts.should.eql([2, 6, 6]));

      }));
    });
  });

  describe('form schemas and dataset properties', () => {
    it('should populate entity properties based on correct form schema', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      // Submission to old (and only) version of form should have only age filled in
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Upload a new version of the form with saveto added to hometown
      await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity
          .replace('<bind nodeset="/data/hometown" type="string"/>', '<bind nodeset="/data/hometown" type="string" entities:saveto="hometown"/>'))
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/draft/publish?version=2.0')
        .expect(200);

      // Submission to old version of form should make entity with age filled in
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Submission to new version of form should make entity with hometown filled in
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.three.replace('version="1.0"', 'version="2.0"'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Upload a new version of the form with saveto removed from age
      await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity
          .replace('<bind nodeset="/data/age" type="int" entities:saveto="age"/>', '<bind nodeset="/data/age" type="int"/>')
          .replace('<bind nodeset="/data/hometown" type="string"/>', '<bind nodeset="/data/hometown" type="string" entities:saveto="hometown"/>'))
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/draft/publish?version=3.0')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.four.replace('version="1.0"', 'version="3.0"'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Submission 1 - should just have name and age
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.should.have.property('data').which.is.eql({ age: '88', first_name: 'Alice' });
        });

      // Submission 2 - should also just have name and age
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789aaa')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.should.have.property('data').which.is.eql({ age: '30', first_name: 'Jane' });
        });

      // Submission 3 - should have name, age and hometown filled in
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789bbb')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.should.have.property('data').which.is.eql({ age: '40', hometown: 'Toronto', first_name: 'John' });
        });

      // Submission 4 - should have name and hometown filled in, NO age
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ccc')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.should.have.property('data').which.is.eql({ first_name: 'Robert', hometown: 'Seattle' });
        });
    }));

    // c#551 issue, <entity/> tag has no children
    it('should allow update where no label or no properties are updated and entity block is childless', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      const form = `<?xml version="1.0"?>
      <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
        <h:head>
          <model entities:entities-version="2024.1.0">
            <instance>
              <data id="brokenForm" orx:version="1.0">
                <age foo="bar"/>
                <meta>
                  <entity dataset="people" id="" create="" update="" baseVersion="" trunkVersion="" branchId=""/>
                </meta>
              </data>
            </instance>
            <bind nodeset="/data/age" type="int" entities:saveto="age"/>
          </model>
        </h:head>
      </h:html>`;

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(form)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'First Label',
          data: { age: '11' }
        })
        .expect(200);

      const sub = `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="brokenForm" version="1.0">
        <meta>
          <instanceID>one</instanceID>
          <orx:instanceName>one</orx:instanceName>
          <entity baseVersion="1" dataset="people" id="12345678-1234-4123-8234-123456789abc" update="1" />
        </meta>
      </data>`;

      await asAlice.post('/v1/projects/1/forms/brokenForm/submissions')
        .send(sub)
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
        .expect(200)
        .then(({ body: versions }) => {
          versions[1].version.should.equal(2);
          versions[1].baseVersion.should.equal(1);
          versions[1].label.should.equal('First Label');
          versions[1].data.should.eql({ age: '11' });
          versions[1].dataReceived.should.eql({});
        });

      await asAlice.get('/v1/projects/1/forms/brokenForm/submissions/one/audits')
        .expect(200)
        .then(({ body: logs }) => {
          logs[0].action.should.equal('entity.update.version');
        });
    }));

    // c#552 issue, can't add label to entity update form that previously didnt have label
    it('should allow label to be added to entity block in new version of form', testService(async (service) => {
      const asAlice = await service.login('alice');

      const form = `<?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms">
        <h:head>
          <model entities:entities-version="2024.1.0">
            <instance>
              <data id="brokenForm" orx:version="1.0">
                <age foo="bar"/>
                <meta>
                  <entity dataset="people" id="" create="" update="" baseVersion="" trunkVersion="" branchId="" />
                </meta>
              </data>
            </instance>
            <bind nodeset="/data/age" type="int" entities:saveto="age"/>
          </model>
        </h:head>
      </h:html>`;

      const form2 = `<?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms">
        <h:head>
          <model entities:entities-version="2024.1.0">
            <instance>
              <data id="brokenForm" orx:version="2.0">
                <age foo="bar"/>
                <meta>
                  <entity dataset="people" id="" create="" update="" baseVersion=""  trunkVersion="" branchId="">
                    <label/>
                  </entity>
                </meta>
              </data>
            </instance>
            <bind nodeset="/data/age" type="int" entities:saveto="age"/>
          </model>
        </h:head>
      </h:html>`;

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(form)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/brokenForm/draft')
        .send(form2)
        .set('Content-Type', 'application/xml')
        .expect(200);
    }));

    // c#553 issue, forms with and without entity label show different fields
    // (because entity was previously type 'unknown' instead of 'structure')
    it('should show same field type (structure) for meta/entity tag with and without children', testService(async (service) => {
      const asAlice = await service.login('alice');

      const form = `<?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms">
        <h:head>
          <model entities:entities-version="2024.1.0">
            <instance>
              <data id="updateWithoutLabel" orx:version="1.0">
                <age foo="bar"/>
                <meta>
                  <entity dataset="people" id="" update="" baseVersion="" trunkVersion="" branchId=""/>
                </meta>
              </data>
            </instance>
            <bind nodeset="/data/age" type="int" entities:saveto="age"/>
          </model>
        </h:head>
      </h:html>`;

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(form)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Form with label nested under entity
      const form2 = `<?xml version="1.0"?>
      <h:html xmlns:entities="http://www.opendatakit.org/xforms">
        <h:head>
          <model entities:entities-version="2024.1.0">
            <instance>
              <data id="updateWithLabel" orx:version="1.0">
                <age foo="bar"/>
                <meta>
                  <entity dataset="people" id="" update="" baseVersion="" trunkVersion="" branchId="">
                    <label/>
                  </entity>
                </meta>
              </data>
            </instance>
            <bind nodeset="/data/age" type="int" entities:saveto="age"/>
          </model>
        </h:head>
      </h:html>`;

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(form2)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Compare form fields
      await asAlice.get('/v1/projects/1/forms/updateWithoutLabel/fields?odata=true')
        .then(({ body }) => {
          body[2].path.should.equal('/meta/entity');
          body[2].type.should.equal('structure');

          body.length.should.equal(3);
        });

      await asAlice.get('/v1/projects/1/forms/updateWithLabel/fields?odata=true')
        .then(({ body }) => {
          body[2].path.should.equal('/meta/entity');
          body[2].type.should.equal('structure');

          body[3].path.should.equal('/meta/entity/label');
          body.length.should.equal(4);
        });
    }));

    it('should gracefully handle error if incoming entity tag in sub has no attributes', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      const form = `<?xml version="1.0"?>
      <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
        <h:head>
          <model entities:entities-version="2024.1.0">
            <instance>
              <data id="brokenForm" orx:version="1.0">
                <age foo="bar"/>
                <meta>
                  <entity dataset="people" id="" update="" baseVersion="" trunkVersion="" branchId=""/>
                </meta>
              </data>
            </instance>
            <bind nodeset="/data/age" type="int" entities:saveto="age"/>
          </model>
        </h:head>
      </h:html>`;

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(form)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'First Label',
          data: { age: '11' }
        })
        .expect(200);

      const sub = `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="brokenForm" version="1.0">
        <meta>
          <instanceID>one</instanceID>
          <orx:instanceName>one</orx:instanceName>
          <entity/>
        </meta>
      </data>`;

      await asAlice.post('/v1/projects/1/forms/brokenForm/submissions')
        .send(sub)
        .expect(200);

      await exhaust(container);

      await asAlice.get('/v1/projects/1/forms/brokenForm/submissions/one/audits')
        .expect(200)
        .then(({ body: logs }) => {
          logs[0].action.should.equal('entity.error');
          logs[0].details.errorMessage.should.equal('Required parameter dataset missing.');
        });
    }));
  });

  describe('dataset and entities should have isolated lifecycle', () => {
    it('should allow a form that has created an entity to be purged', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
        .send({ reviewState: 'approved' })
        .expect(200);

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity.replace('simpleEntity', 'simpleEntityDup'))
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntityDup/submissions')
        .send(testData.instances.simpleEntity.one
          .replace('simpleEntity', 'simpleEntityDup')
          .replace(/Alice/g, 'Jane')
          .replace('12345678-1234-4123-8234-123456789abc', '12345678-1234-4123-8234-123456789def'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.patch('/v1/projects/1/forms/simpleEntityDup/submissions/one')
        .send({ reviewState: 'approved' })
        .expect(200);

      await exhaust(container);

      await asAlice.delete('/v1/projects/1/forms/simpleEntity')
        .expect(200);

      await container.Forms.purge(true);

      await container.all(sql`SELECT * FROM entity_defs
        JOIN entity_def_sources ON entity_defs."sourceId" = entity_def_sources.id`)
        .then(eDefs => {
          // Ensures that we are only clearing submissionDefId of entities whose submission/form is purged
          should(eDefs.find(d => d.data.first_name === 'Alice').submissionDefId).be.null();
          should(eDefs.find(d => d.data.first_name === 'Jane').submissionDefId).not.be.null();
        });
    }));

    it('should return published dataset even if corresponding form is deleted', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await asAlice.delete('/v1/projects/1/forms/simpleEntity')
        .expect(200);

      await container.Forms.purge(true);

      await asAlice.get('/v1/projects/1/datasets')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(1);
        });
    }));

    it('should keep dataset and its property status intact even if corresponding form is deleted', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await asAlice.delete('/v1/projects/1/forms/simpleEntity')
        .expect(200);

      await container.Forms.purge(true);

      // let's create another form that defines same dataset with a different property
      await asAlice.post('/v1/projects/1/forms')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity
          .replace(/first_name/g, 'last_name')
          .replace(/simpleEntity/g, 'simpleEntityDup'))
        .expect(200);

      await asAlice.get('/v1/projects/1/forms/simpleEntityDup/draft/dataset-diff')
        .expect(200)
        .then(({ body }) => {
          body.should.be.eql([{
            name: 'people',
            isNew: false,
            properties: [
              { name: 'first_name', isNew: false, inForm: false },
              { name: 'last_name', isNew: true, inForm: true },
              { name: 'age', isNew: false, inForm: true }
            ]
          }]);
        });

    }));

  });

  // These tests test most everything about approvalRequired. They also test the
  // endpoint as a whole for updating dataset settings, including ownerOnly. We
  // test the specific behavior of ownerOnly in a separate test suite below, but
  // in this test suite, we test that ownerOnly can be updated.
  describe('approvalRequired and updating dataset settings', () => {
    describe('PATCH /datasets/:name', () => {

      it('should return notfound if the dataset does not exist', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.patch('/v1/projects/1/datasets/nonexistent')
          .expect(404);
      }));

      it('should reject if the user cannot read', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        const asChelsea = await service.login('chelsea');

        await asChelsea.patch('/v1/projects/1/datasets/people')
          .expect(403);
      }));

      it('should allow updating settings', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await asAlice.get('/v1/projects/1/datasets/people')
          .expect(200)
          .then(({ body }) => {
            body.should.containEql({ approvalRequired: false, ownerOnly: false });
          });
        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true, ownerOnly: true })
          .expect(200)
          .then(({ body }) => {
            body.should.containEql({ approvalRequired: true, ownerOnly: true });
          });
      }));

      it('should disallow writing/changing dataset name', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true, name: 'frogs' })
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/frogs')
          .expect(404);

        await asAlice.get('/v1/projects/1/datasets/people')
          .expect(200)
          .then(({ body }) => {
            body.name.should.equal('people');
          });

      }));

      it('should return bad request if value of convert query param is invalid', testService(async (service) => {

        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people?convert=dummy')
          .send({ approvalRequired: true })
          .expect(400)
          .then(({ body }) => {
            body.code.should.be.eql(400.8);
          });

      }));

      it('should return warning for approvalRequired if there are pending submissions', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.two)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: false })
          .expect(400)
          .then(({ body }) => {
            body.code.should.be.eql(400.29);
            body.details.count.should.be.eql(1);
          });
      }));

      it('should not return a warning for ownerOnly by itself', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.two)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ ownerOnly: true })
          .expect(200);
      }));

      it('should update dataset when pending submissions are draft or deleted', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
          .expect(200);

        // Draft submission
        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft/submissions')
          .send(testData.instances.simpleEntity.two)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        await asAlice.delete('/v1/projects/1/forms/simpleEntity')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: false })
          .expect(200);
      }));

      it('should update approvalRequired without automatic conversions', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people?convert=false')
          .send({ approvalRequired: false })
          .expect(200)
          .then(({ body }) => body.approvalRequired.should.be.false());

        // there are no entities
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => body.should.be.eql([]));

        // The audit log has `autoConvert: false`.
        await asAlice.get('/v1/audits?action=dataset.update&limit=1')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].details.should.eql({
              data: { approvalRequired: false },
              autoConvert: false
            });
          });
      }));

      it('should automatically convert pending submissions', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.two)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        // There are no entities
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => body.length.should.be.eql(0));

        await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
          .send({ approvalRequired: false })
          .expect(200)
          .then(({ body }) => body.approvalRequired.should.be.false());

        await exhaust(container);

        // Entities are created now
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => body.length.should.be.eql(2));

        // The audit log has `autoConvert: true`.
        await asAlice.get('/v1/audits?action=dataset.update&limit=1')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].details.should.eql({
              data: { approvalRequired: false },
              autoConvert: true
            });
          });

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].should.be.an.Audit();
            logs[0].action.should.be.eql('entity.create');
            logs[0].actor.displayName.should.be.eql('Alice');

            logs[0].details.source.submission.should.be.a.Submission();
            logs[0].details.source.submission.xmlFormId.should.be.eql('simpleEntity');
            logs[0].details.source.submission.currentVersion.instanceName.should.be.eql('one');
            logs[0].details.source.submission.currentVersion.submitter.displayName.should.be.eql('Alice');
          });
      }));

      it('should not convert pending submissions after only ownerOnly is updated', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await exhaust(container);

        // There are no entities.
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => {
            body.length.should.be.equal(0);
          });

        // convert=true should be silently ignored if approvalRequired is not
        // specified.
        await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
          .send({ ownerOnly: true })
          .expect(200);
        await exhaust(container);

        // Still no entities.
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => {
            body.length.should.be.equal(0);
          });
        // The audit log does not mention autoConvert, which is not relevant.
        await asAlice.get('/v1/audits?action=dataset.update&limit=1')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].details.should.eql({
              data: { ownerOnly: true }
            });
          });
      }));

      it('should not convert deleted submissions', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        // There are no entities because approval is required
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => body.length.should.be.eql(0));

        // Delete the form which means submissions are to be deleted
        // Currently we don't have a way to delete a Submission
        await asAlice.delete('/v1/projects/1/forms/simpleEntity')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
          .send({ approvalRequired: false })
          .expect(200)
          .then(({ body }) => body.approvalRequired.should.be.false());

        await exhaust(container);

        // Still no Entities
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => body.length.should.be.eql(0));
      }));

      it('should not convert draft submissions', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
          .expect(200);

        // Draft submission
        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
          .send({ approvalRequired: false })
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => body.should.be.eql([]));
      }));

      it('should log error if there is a problem in a submission while auto converting', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one.replace('<entities:label>Alice (88)</entities:label>', '')) //removing label
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.two)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.three.replace('create="1"', 'create="0"')) // don't create entity
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        // There are no entities
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => body.length.should.be.eql(0));

        await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
          .send({ approvalRequired: false })
          .expect(200)
          .then(({ body }) => body.approvalRequired.should.be.false());

        await exhaust(container);

        // One Entity is created
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => {
            body.length.should.be.eql(1);
          });

        const entityErrors = await container.Audits.get(new QueryOptions({ args: { action: 'entity.error' } }));

        entityErrors.length.should.be.eql(1);
        entityErrors[0].details.errorMessage.should.match(/Required parameter label missing/);

      }));

      it('should use latest version of submission in pending submissions', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        // submission is edited to create different entity
        await asAlice.put('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send(testData.instances.simpleEntity.one
            .replace('id="uuid:12345678-1234-4123-8234-123456789abc"', 'id="uuid:12345678-1234-4123-8234-123456789bbb"')
            .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
          .send({ approvalRequired: false })
          .expect(200)
          .then(({ body }) => body.approvalRequired.should.be.false());

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].uuid.should.equal('12345678-1234-4123-8234-123456789bbb');
          });
      }));

      it('should use latest version of submission (updated to not create entity) in pending submissions', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        // submission is edited to create different entity
        await asAlice.put('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send(testData.instances.simpleEntity.one
            .replace('create="1"', 'create="0"')
            .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
          .send({ approvalRequired: false })
          .expect(200)
          .then(({ body }) => body.approvalRequired.should.be.false());

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(0);
          });
      }));

      it('should do something reasonable with pending submissions when they contain entity updates', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        // can use update form to make dataset populate via api
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.updateEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        // populate one entity
        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Johnny Doe',
            data: { first_name: 'Johnny', age: '22' }
          })
          .expect(200);

        // I also want one actual submission create that needs approval to run
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.two)
          .expect(200);

        // send update submissions!
        // this is an update so it will be processed without needing to be approved.
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.three)
          .set('Content-Type', 'application/xml')
          .expect(200);

        // this will also process the create entity submission, but it wont make an entity
        await exhaust(container);

        // at this point, the main entity has been updated
        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body: person }) => {
            person.currentVersion.data.age.should.equal('55');
            person.currentVersion.version.should.equal(2);
          });

        // the second entity has not yet been created because it needs submission approval
        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789aaa')
          .expect(404);

        // send next two submission
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.three
            .replace('<instanceID>three</instanceID>', '<instanceID>four</instanceID>')
            .replace('<age>55</age>', '<age>66</age>'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        // send next submission
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.three
            .replace('<instanceID>three</instanceID>', '<instanceID>five</instanceID>')
            .replace('<age>55</age>', '<age>77</age>'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        // exhaust hasn't run yet so the one create submission and two update submissions count as pending
        // central has no way to know if a submission is a create or update until it reads the submission
        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: false })
          .expect(400)
          .then(({ body }) => {
            body.code.should.be.eql(400.29);
            body.details.count.should.be.eql(3);
          });

        await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
          .send({ approvalRequired: false })
          .expect(200)
          .then(({ body }) => body.approvalRequired.should.be.false());

        // send another submission
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.three
            .replace('<instanceID>three</instanceID>', '<instanceID>six</instanceID>')
            .replace('<age>55</age>', '<age>888</age>'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        // at this point, none of the new submissions have been processed
        // the unprocessed audit log looks like this with the datset.update event between some submission events
        const unprocessedAudits = await container.Audits.get(new QueryOptions({ condition: { processed: null } }));
        unprocessedAudits.map(a => a.action).should.eql([
          'submission.create',
          'dataset.update',
          'submission.create',
          'submission.create'
        ]);

        await exhaust(container);

        // main entity with many updates
        // events should all look like submission.create events (vs. dataset update events)
        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
          .expect(200)
          .then(({ body: logs }) => {
            const updateDetails = logs.filter(log => log.action === 'entity.update.version').map(log => log.details);
            updateDetails.length.should.equal(4);
            updateDetails.filter(d => d.source.event.action === 'submission.create').length.should.equal(4);
            updateDetails.map(d => d.source.submission.instanceId).should.eql([
              'six', 'five', 'four', 'three'
            ]);
          });

        // other entity that was created
        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789aaa/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.equal('entity.create');
            logs[0].details.source.submission.xmlFormId.should.equal('simpleEntity');
            logs[0].details.source.submission.instanceId.should.equal('two');
            logs[0].details.source.event.action.should.equal('submission.create');
          });

        // only one entity def should have a source with a non-null parent id
        // the submission that only created an entity
        const defSourceParentIds = await container.all(sql`
        select eds.details->'submission'->'instanceId' as "submissionInstanceId"
        from entity_defs as ed
        join entity_def_sources as eds on ed."sourceId" = eds.id
        where eds.details->'parentEventId' is not null`);
        defSourceParentIds.length.should.equal(1);
        defSourceParentIds[0].submissionInstanceId.should.equal('two');
      }));
    });

    it('should not let submission edits get caught in pending submission count', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      // Upload form that creates an entity list and publish it
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Configure the entity list to create entities on submission approval
      await asAlice.patch('/v1/projects/1/datasets/people')
        .send({ approvalRequired: true })
        .expect(200);

      // Populate one entity
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Johnny Doe',
          data: { first_name: 'Johnny', age: '22' }
        })
        .expect(200);

      // Upload form that updates entities
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.updateEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Send submission
      await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Observe that entity was updated
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.data.age.should.equal('85');
          person.currentVersion.version.should.equal(2);
        });

      // Edit the submission
      await asAlice.patch('/v1/projects/1/forms/updateEntity/submissions/one')
        .send(testData.instances.updateEntity.one
          .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2')
          .replace('<age>85</age>', '<age>99</age>'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Should do nothing
      await exhaust(container);

      // Observe that nothing else happened with the entity
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.data.age.should.equal('85');
          person.currentVersion.version.should.equal(2);
        });

      // count return 200 instead of 400 error with pending submission count
      await asAlice.patch('/v1/projects/1/datasets/people')
        .send({ approvalRequired: false })
        .expect(200);
    }));

    describe('central issue #547, reprocessing submissions that had previous entity errors', () => {
      it('should not reprocess submission that previously generated entity.error', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        // Upload form that creates an entity list and publish it
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        // Configure the entity list to create entities on submission approval
        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        // Create a submission that fails to create an entity (empty label)
        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one
            .replace('<entities:label>Alice (88)</entities:label>', ''))
          .set('Content-Type', 'application/xml')
          .expect(200);

        // Approve the submission.
        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs.filter((log => log.action === 'entity.error')).length.should.equal(1);
          });

        // Mark the submission as "has issues".
        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'hasIssues' })
          .expect(200);

        // Change the entity list and select yes to processing pending submissions.
        await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
          .send({ approvalRequired: false })
          .expect(200);

        await exhaust(container);

        // Observe that the submission that failed to create an entity has NOT been reprocessed.
        // There is only one entity.error before the update.
        await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs.filter((log => log.action === 'entity.error')).length.should.equal(1);

            const actions = logs.map(log => log.action);
            actions.should.eql([
              'submission.update', // set to hasIssue
              'entity.error', // first processing
              'submission.update', // approval
              'submission.create'
            ]);
          });
      }));

      it('should reprocess submission that was edited after previously generating entity.error', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        // Upload form that creates an entity list and publish it
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        // Configure the entity list to create entities on submission approval
        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        // Create a submission that fails to create an entity (empty label)
        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one
            .replace('<entities:label>Alice (88)</entities:label>', ''))
          .set('Content-Type', 'application/xml')
          .expect(200);

        // Approve the submission.
        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        // Observe that it created an error
        await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs.filter((log => log.action === 'entity.error')).length.should.equal(1);
          });

        // Update the submission to resolve the error
        await asAlice.put('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send(testData.instances.simpleEntity.one
            .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        // Do not approve the submission yet
        // Check the unprocessed submissions
        const ds = await container.Datasets.get(1, 'people').then(o => o.get());
        const subs = await container.Datasets.getUnprocessedSubmissions(ds.id);
        subs.length.should.equal(1);

        // Change the entity list and select yes to processing pending submissions.
        await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
          .send({ approvalRequired: false })
          .expect(200);

        await exhaust(container);

        // Observe that the entity has now been created
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            body[0].uuid.should.equal('12345678-1234-4123-8234-123456789abc');
          });

        // Observe that the submission that failed to create an entity HAS been reprocessed.
        // There is only one entity.error before the update.
        await asAlice.get('/v1/projects/1/forms/simpleEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs.filter((log => log.action === 'entity.error')).length.should.equal(1);

            const actions = logs.map(log => log.action);
            actions.should.eql([
              'entity.create', // second processing
              'submission.update.version', // submission edited
              'entity.error', // first processing
              'submission.update', // approval
              'submission.create'
            ]);
          });
      }));

      it('should not reprocessed an update caught up in the pending submission scenario ', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        // Upload form that creates an entity list and publish it
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        // Upload form that updates an entity list and publish it
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.updateEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        // Configure the entity list to create entities on submission approval
        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        // Create a submission that would create an entity on approval. Don't approve it yet.
        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        // Create a submission that would update the entity created by the previous submission
        // (which doesn't exist yet because it hasn't been approved)
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        // Observe that the update was processed immediately but resulted in an entity.error
        await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.equal('entity.error');
          });

        // Observe that the entity was not created or updated yet
        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(404);

        // Change the entity list and select yes to processing pending submissions.
        await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
          .send({ approvalRequired: false })
          .expect(200);

        await exhaust(container);

        // Observe that the submission that failed to update an entity has not been reprocessed
        await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.equal('entity.error');
          });

        // There was no second update attempt because the entity was not reprocessed
        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
          .then(({ body: versions }) => {
            versions.length.should.equal(1);
          });

        // Edit the submission so the new def will update the entity
        await asAlice.post('/v1/projects/1/forms/updateEntity/submissions')
          .send(testData.instances.updateEntity.one
            .replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        // Observe that now the entity has been updated
        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/versions')
          .then(({ body: versions }) => {
            versions.length.should.equal(2);
          });

        // Observe that the entity's audit says it was updated by the new edited submission
        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
          .then(({ body: logs }) => {
            logs[0].details.source.submission.instanceId.should.equal('one2');
          });

        // Observe that the submission's audit log makes sense
        await asAlice.get('/v1/projects/1/forms/updateEntity/submissions/one2/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].action.should.equal('entity.update.version');
          });
      }));
    });
  });

  describe('ownerOnly', () => {
    // Sets up the data for each test to follow.
    const createData = async (asAlice) => {
      // Create an entity list named people.
      await asAlice.post('/v1/projects/1/datasets')
        .send({ name: 'people', ownerOnly: true })
        .expect(200);

      // Publish a form that uses the entity list, linking a form attachment to
      // the entity list.
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.withAttachments
          .replace('goodone.csv', 'people.csv'))
        .set('Content-Type', 'application/xml')
        .expect(200);
      await asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
        .expect(200)
        .then(({ body }) => {
          const csv = body.find(attachment => attachment.name === 'people.csv');
          should.exist(csv);
          csv.datasetExists.should.be.true();
        });

      // Publish a form that updates the entity list. Actors who can only
      // submission.create, not entity.create, will use this form to create
      // entities.
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Have Alice create an entity.
      await asAlice.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789aaa',
          label: 'Made by Alice'
        })
        .expect(200);
    };
    const assignToProject = async (asAlice, asAssignee, role) => {
      const assigneeId = await asAssignee.get('/v1/users/current')
        .expect(200)
        .then(({ body }) => body.id);
      await asAlice.post(`/v1/projects/1/assignments/${role}/${assigneeId}`)
        .expect(200);
    };
    // Parses an entities .csv file, returning the entity labels.
    const parseLabels = (text) => {
      const rows = text.split('\n');
      rows.length.should.be.above(1);

      // Discard column headers.
      rows[0].should.match(/^(__id|name),label,/);
      rows.shift();

      // Discard the last row, which is empty.
      last(rows).should.equal('');
      rows.pop();

      return rows.map(row => {
        const match = row.match(/^[\w-]+,([^,]+),/);
        should.exist(match);
        return match[1];
      });
    };

    it('ignores the flag for an admin', testService(async (service) => {
      const [asAlice, asBob] = await service.login(['alice', 'bob']);
      await createData(asAlice);

      // Have Bob create an entity.
      await asBob.post('/v1/projects/1/datasets/people/entities')
        .send({
          uuid: '12345678-1234-4123-8234-123456789abc',
          label: 'Made by Bob'
        })
        .expect(200);

      // All entities are returned to Alice.
      await asAlice.get('/v1/projects/1/forms/withAttachments/attachments/people.csv')
        .expect(200)
        .then(({ text }) => {
          parseLabels(text).should.eqlInAnyOrder(['Made by Alice', 'Made by Bob']);
        });
      await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
        .expect(200)
        .then(({ text }) => {
          parseLabels(text).should.eqlInAnyOrder(['Made by Alice', 'Made by Bob']);
        });
      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities')
        .expect(200)
        .then(({ body }) => {
          const labels = body.value.map(entity => entity.label);
          labels.should.eqlInAnyOrder(['Made by Alice', 'Made by Bob']);
        });
    }));

    it('ignores the flag for a project manager', testService(async (service) => {
      const [asAlice, asBob] = await service.login(['alice', 'bob']);
      await createData(asAlice);

      // All entities (i.e., the one created by Alice) are returned to Bob.
      await asBob.get('/v1/projects/1/forms/withAttachments/attachments/people.csv')
        .expect(200)
        .then(({ text }) => {
          parseLabels(text).should.eql(['Made by Alice']);
        });
      await asBob.get('/v1/projects/1/datasets/people/entities.csv')
        .expect(200)
        .then(({ text }) => {
          parseLabels(text).should.eql(['Made by Alice']);
        });
      await asBob.get('/v1/projects/1/datasets/people.svc/Entities')
        .expect(200)
        .then(({ body }) => {
          const labels = body.value.map(entity => entity.label);
          labels.should.eql(['Made by Alice']);
        });
    }));

    it('ignores the flag for a project viewer', testService(async (service) => {
      const [asAlice, asChelsea] = await service.login(['alice', 'chelsea']);
      await createData(asAlice);
      await assignToProject(asAlice, asChelsea, 'viewer');

      // All entities (i.e., the one created by Alice) are returned to Chelsea.
      await asChelsea.get('/v1/projects/1/forms/withAttachments/attachments/people.csv')
        .expect(200)
        .then(({ text }) => {
          parseLabels(text).should.eql(['Made by Alice']);
        });
      await asChelsea.get('/v1/projects/1/datasets/people/entities.csv')
        .expect(200)
        .then(({ text }) => {
          parseLabels(text).should.eql(['Made by Alice']);
        });
      await asChelsea.get('/v1/projects/1/datasets/people.svc/Entities')
        .expect(200)
        .then(({ body }) => {
          const labels = body.value.map(entity => entity.label);
          labels.should.eqlInAnyOrder(['Made by Alice']);
        });
    }));

    it('ignores the flag in /v1/test', testService(async (service) => {
      const asAlice = await service.login('alice');
      await createData(asAlice);

      // Create a form draft.
      await asAlice.post('/v1/projects/1/forms/withAttachments/draft')
        .expect(200);
      const draftToken = await asAlice.get('/v1/projects/1/forms/withAttachments/draft')
        .expect(200)
        .then(({ body }) => body.draftToken);

      // All entities (i.e., the one created by Alice) are returned from /v1/test.
      await service.get(`/v1/test/${draftToken}/projects/1/forms/withAttachments/draft/attachments/people.csv`)
        .expect(200)
        .then(({ text }) => {
          parseLabels(text).should.eql(['Made by Alice']);
        });
    }));

    it('limits entity access for a Data Collector', testService(async (service, container) => {
      const [asAlice, asChelsea] = await service.login(['alice', 'chelsea']);
      await createData(asAlice);
      await assignToProject(asAlice, asChelsea, 'formfill');

      // Have Chelsea create an entity.
      await asChelsea.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);
      await exhaust(container);

      // Only the entity that Chelsea created is returned.
      await asChelsea.get('/v1/projects/1/forms/withAttachments/attachments/people.csv')
        .expect(200)
        .then(({ text }) => {
          parseLabels(text).should.eql(['Alice (88)']);
        });
    }));

    it('does not limit access if the flag is false', testService(async (service) => {
      const [asAlice, asChelsea] = await service.login(['alice', 'chelsea']);
      await createData(asAlice);
      await assignToProject(asAlice, asChelsea, 'formfill');

      // Change ownerOnly to false.
      await asAlice.patch('/v1/projects/1/datasets/people')
        .send({ ownerOnly: false })
        .expect(200);

      // All entities (i.e., the one created by Alice) are returned to Chelsea.
      await asChelsea.get('/v1/projects/1/forms/withAttachments/attachments/people.csv')
        .expect(200)
        .then(({ text }) => {
          parseLabels(text).should.eql(['Made by Alice']);
        });
    }));

    // Most of these tests use testServiceFullTrx, because accurate timestamps
    // are important for verification. In contrast, testService wraps everything
    // in a transaction, which freezes some timestamps.
    describe('OpenRosa hash', () => {
      const getHash = async (asUser) => {
        const hash = await asUser.get('/v1/projects/1/forms/withAttachments/attachments/people.csv')
          .expect(200)
          .then(response => response.get('ETag').replaceAll('"', ''));

        // Check that the hash from the REST API matches the OpenRosa manifest.
        const { text: manifest } = await asUser.get('/v1/projects/1/forms/withAttachments/manifest')
          .set('X-OpenRosa-Version', '1.0')
          .expect(200);
        manifest.replace(/\s/g, '').should.containEql(`<filename>people.csv</filename><hash>md5:${hash}</hash>`);

        return hash;
      };

      it('returns same hash as normal for users who can entity.list', testService(async (service, container) => {
        const [asAlice, asBob, asChelsea] = await service.login(['alice', 'bob', 'chelsea']);
        await createData(asAlice);
        assignToProject(asAlice, asChelsea, 'viewer');

        const originalHash = await getHash(asAlice);
        (await getHash(asBob)).should.equal(originalHash);
        (await getHash(asChelsea)).should.equal(originalHash);

        // Change ownerOnly to false.
        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ ownerOnly: false })
          .expect(200);
        // Delete the latest audit log entry about toggling ownerOnly, which
        // would affect the hash.
        await container.run(sql`DELETE FROM audits WHERE id = (SELECT MAX(id) FROM audits)`);

        (await getHash(asAlice)).should.equal(originalHash);
        (await getHash(asBob)).should.equal(originalHash);
        (await getHash(asChelsea)).should.equal(originalHash);
      }));

      it('returns different hash for a data collector', testService(async (service) => {
        const [asAlice, asChelsea] = await service.login(['alice', 'chelsea']);
        await createData(asAlice);
        await assignToProject(asAlice, asChelsea, 'formfill');
        (await getHash(asChelsea)).should.not.equal(await getHash(asAlice));
      }));

      it('returns same hash as normal for a data collector if flag is false', testService(async (service) => {
        const [asAlice, asChelsea] = await service.login(['alice', 'chelsea']);
        await createData(asAlice);
        await assignToProject(asAlice, asChelsea, 'formfill');

        // Change ownerOnly to false.
        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ ownerOnly: false })
          .expect(200);

        (await getHash(asChelsea)).should.equal(await getHash(asAlice));
      }));

      it('does not change hash of a different dataset', testService(async (service) => {
        const [asAlice, asChelsea] = await service.login(['alice', 'chelsea']);
        await createData(asAlice);
        await assignToProject(asAlice, asChelsea, 'formfill');

        // Create a new dataset that's set up similarly to people, but for which
        // ownerOnly is false.
        await asAlice.post('/v1/projects/1/datasets')
          .send({ name: 'trees', ownerOnly: false })
          .expect(200);
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.withAttachments
            .replace('id="withAttachments"', 'id="withTrees"')
            .replace('goodone.csv', 'trees.csv'))
          .set('Content-Type', 'application/xml')
          .expect(200);
        await asAlice.post('/v1/projects/1/datasets/trees/entities')
          .send({
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'elm'
          })
          .expect(200);

        // Alice and Chelsea get different hashes for people, but the same hash
        // for trees. The fact that ownerOnly is set on people does not affect
        // trees.
        (await getHash(asChelsea)).should.not.equal(await getHash(asAlice));
        const treeETagForAlice = await asAlice.get('/v1/projects/1/forms/withTrees/attachments/trees.csv')
          .expect(200)
          .then(response => {
            response.text.split('\n').length.should.equal(3);
            return response.get('ETag').replaceAll('"', '');
          });
        const treeETagForChelsea = await asChelsea.get('/v1/projects/1/forms/withTrees/attachments/trees.csv')
          .expect(200)
          .then(response => response.get('ETag').replaceAll('"', ''));
        treeETagForAlice.should.equal(treeETagForChelsea);
      }));

      it('changes hash after a data collector creates an entity', testServiceFullTrx(async (service, container) => {
        const [asAlice, asChelsea] = await service.login(['alice', 'chelsea']);
        await createData(asAlice);
        await assignToProject(asAlice, asChelsea, 'formfill');
        const originalHash = await getHash(asChelsea);

        // Have Chelsea create an entity.
        await asChelsea.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await exhaust(container);

        (await getHash(asChelsea)).should.not.equal(originalHash);
      }));

      it('does not change hash after someone else creates an entity', testServiceFullTrx(async (service) => {
        const [asAlice, asChelsea] = await service.login(['alice', 'chelsea']);
        await createData(asAlice);
        await assignToProject(asAlice, asChelsea, 'formfill');
        const originalHash = await getHash(asChelsea);

        // Have Alice create a second entity.
        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            uuid: '12345678-1234-4123-8234-123456789abc',
            label: 'Made by Alice (2)'
          })
          .expect(200);

        (await getHash(asChelsea)).should.equal(originalHash);
      }));

      it('changes hash after an entity is updated', testServiceFullTrx(async (service, container) => {
        const [asAlice, asChelsea] = await service.login(['alice', 'chelsea']);
        await createData(asAlice);
        await assignToProject(asAlice, asChelsea, 'formfill');

        // Have Chelsea create an entity.
        await asChelsea.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await exhaust(container);
        const originalHash = await getHash(asChelsea);

        // Update the entity.
        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?baseVersion=1')
          .send({ data: { age: '120' } })
          .expect(200);
        (await getHash(asChelsea)).should.not.equal(originalHash);
      }));

      it('changes hash after an entity is deleted', testServiceFullTrx(async (service, container) => {
        const [asAlice, asChelsea] = await service.login(['alice', 'chelsea']);
        await createData(asAlice);
        await assignToProject(asAlice, asChelsea, 'formfill');

        // Have Chelsea create an entity.
        await asChelsea.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await exhaust(container);
        const originalHash = await getHash(asChelsea);

        // Delete the entity.
        await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200);
        (await getHash(asChelsea)).should.not.equal(originalHash);
      }));

      it('does not change hash after an entity is purged', testServiceFullTrx(async (service, container) => {
        const [asAlice, asChelsea] = await service.login(['alice', 'chelsea']);
        await createData(asAlice);
        await assignToProject(asAlice, asChelsea, 'formfill');

        // Have Chelsea create an entity.
        await asChelsea.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await exhaust(container);
        const hash1 = await getHash(asChelsea);

        // Delete the entity.
        await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200);
        const hash2 = await getHash(asChelsea);

        // Purge the entity.
        await container.Entities.purge(true);
        const hash3 = await getHash(asChelsea);
        hash3.should.equal(hash2);
        hash3.should.not.equal(hash1);
      }));

      it('changes hash after an entity is restored', testServiceFullTrx(async (service, container) => {
        const [asAlice, asChelsea] = await service.login(['alice', 'chelsea']);
        await createData(asAlice);
        await assignToProject(asAlice, asChelsea, 'formfill');

        // Have Chelsea create an entity.
        await asChelsea.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await exhaust(container);
        const hash1 = await getHash(asChelsea);

        // Delete the entity.
        await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200);
        const hash2 = await getHash(asChelsea);

        // Restore the entity.
        await asAlice.post('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/restore')
          .expect(200);
        const hash3 = await getHash(asChelsea);

        [hash1, hash2, hash3].should.be.unique();
      }));

      it('changes hash after an entity is undeleted, then another entity is deleted', testServiceFullTrx(async (service, container) => {
        const [asAlice, asChelsea] = await service.login(['alice', 'chelsea']);
        await createData(asAlice);
        await assignToProject(asAlice, asChelsea, 'formfill');

        // Have Chelsea create 3 entities.
        for (const name of ['one', 'three', 'four']) {
          // eslint-disable-next-line no-await-in-loop
          await asChelsea.post('/v1/projects/1/forms/simpleEntity/submissions')
            .send(testData.instances.simpleEntity[name])
            .set('Content-Type', 'application/xml')
            .expect(200);
          // eslint-disable-next-line no-await-in-loop
          await exhaust(container);
        }
        const hash1 = await getHash(asChelsea);

        // Delete `one`.
        await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200);
        const hash2 = await getHash(asChelsea);

        // Restore `one`, then delete `three`.
        await asAlice.post('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/restore')
          .expect(200);
        await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789bbb')
          .expect(200);
        const hash3 = await getHash(asChelsea);

        [hash1, hash2, hash3].should.be.unique();
      }));

      it('changes hash after a dataset property is added', testServiceFullTrx(async (service) => {
        const [asAlice, asChelsea] = await service.login(['alice', 'chelsea']);
        await createData(asAlice);
        await assignToProject(asAlice, asChelsea, 'formfill');
        const originalHash = await getHash(asChelsea);

        // Add an entity property.
        await asAlice.post('/v1/projects/1/datasets/people/properties')
          .send({ name: 'foo' })
          .expect(200);

        (await getHash(asChelsea)).should.not.equal(originalHash);
      }));

      it('computes hash based on timestamps and the entity count', testServiceFullTrx(async (service, container) => {
        const [asAlice, asChelsea] = await service.login(['alice', 'chelsea']);
        await createData(asAlice);
        await assignToProject(asAlice, asChelsea, 'formfill');

        const { loggedAt } = await asAlice.get('/v1/audits?action=dataset.update')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(1);
            return body[0];
          });
        (await getHash(asChelsea)).should.equal(md5sum(`0,${loggedAt}`));

        // Have Chelsea create an entity.
        await asChelsea.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);
        await exhaust(container);
        const { createdAt } = await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
          .expect(200)
          .then(({ body }) => body);
        (await getHash(asChelsea)).should.equal(md5sum(`1,${createdAt}`));

        // Update the entity.
        const { updatedAt } = await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?baseVersion=1')
          .send({ data: { age: '120' } })
          .expect(200)
          .then(({ body }) => body);
        (await getHash(asChelsea)).should.equal(md5sum(`1,${updatedAt}`));
      }));
    });
  });

  // OpenRosa endpoint
  describe('GET /datasets/:name/integrity', () => {
    it('should return notfound if the dataset does not exist', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.get('/v1/projects/1/datasets/nonexistent/integrity')
        .set('X-OpenRosa-Version', '1.0')
        .expect(404);
    }));

    it('should reject if the user cannot read', testEntities(async (service) => {
      const asChelsea = await service.login('chelsea');

      await asChelsea.get('/v1/projects/1/datasets/people/integrity')
        .set('X-OpenRosa-Version', '1.0')
        .expect(403);
    }));

    it('should happily return given no entities', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/people/integrity')
        .set('X-OpenRosa-Version', '1.0')
        .expect(200)
        .then(async ({ text }) => {
          const result = await xml2js.parseStringPromise(text, { explicitArray: false });
          result.data.entities.should.not.have.property('entity');
        });
    }));

    it('should return data for app-user with access to consuming Form', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      const appUser = await asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'test' })
        .then(({ body }) => body);

      await asAlice.post(`/v1/projects/1/forms/withAttachments/assignments/app-user/${appUser.id}`);

      await service.get(`/v1/key/${appUser.token}/projects/1/datasets/people/integrity`)
        .set('X-OpenRosa-Version', '1.0')
        .expect(200)
        .then(async ({ text }) => {
          const result = await xml2js.parseStringPromise(text, { explicitArray: false });
          result.data.entities.entity.length.should.be.eql(2);
        });
    }));

    it('should reject for app-user if consuming Form is closed', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      const appUser = await asAlice.post('/v1/projects/1/app-users')
        .send({ displayName: 'test' })
        .then(({ body }) => body);

      await asAlice.post(`/v1/projects/1/forms/withAttachments/assignments/app-user/${appUser.id}`);

      await asAlice.patch('/v1/projects/1/forms/withAttachments')
        .send({ state: 'closed' })
        .expect(200);

      await service.get(`/v1/key/${appUser.token}/projects/1/datasets/people/integrity`)
        .set('X-OpenRosa-Version', '1.0')
        .expect(403);
    }));

    it('should return with correct deleted value', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200);

      await asAlice.get(`/v1/projects/1/datasets/people/integrity`)
        .set('X-OpenRosa-Version', '1.0')
        .expect(200)
        .then(async ({ text }) => {
          const result = await xml2js.parseStringPromise(text, { explicitArray: false });
          result.data.entities.entity.length.should.be.eql(2);
          result.data.entities.entity.find(e => e.$.id === '12345678-1234-4123-8234-123456789aaa')
            .deleted.should.be.eql('false');
          result.data.entities.entity.find(e => e.$.id === '12345678-1234-4123-8234-123456789abc')
            .deleted.should.be.eql('true');
        });
    }));

    it('should return purged entities as well', testEntities(async (service, { Entities }) => {
      const asAlice = await service.login('alice');

      await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200);

      await Entities.purge(true);

      await asAlice.get(`/v1/projects/1/datasets/people/integrity`)
        .set('X-OpenRosa-Version', '1.0')
        .expect(200)
        .then(async ({ text }) => {
          const result = await xml2js.parseStringPromise(text, { explicitArray: false });
          result.data.entities.entity.length.should.be.eql(2);
          result.data.entities.entity.find(e => e.$.id === '12345678-1234-4123-8234-123456789aaa')
            .deleted.should.be.eql('false');
          result.data.entities.entity.find(e => e.$.id === '12345678-1234-4123-8234-123456789abc')
            .deleted.should.be.eql('true');
        });
    }));

    it('should return only queried entities', testEntities(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200);

      await asAlice.get(`/v1/projects/1/datasets/people/integrity?id=12345678-1234-4123-8234-123456789abc`)
        .set('X-OpenRosa-Version', '1.0')
        .expect(200)
        .then(async ({ text }) => {
          const result = await xml2js.parseStringPromise(text, { explicitArray: false });
          const { entity } = result.data.entities;
          entity.$.id.should.be.eql('12345678-1234-4123-8234-123456789abc');
          entity.deleted.should.be.eql('true');
        });
    }));

    it('should return only queried purged entities', testEntities(async (service, { Entities }) => {
      const asAlice = await service.login('alice');

      await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200);

      await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789aaa')
        .expect(200);

      await Entities.purge(true);

      await asAlice.get(`/v1/projects/1/datasets/people/integrity?id=12345678-1234-4123-8234-123456789abc`)
        .set('X-OpenRosa-Version', '1.0')
        .expect(200)
        .then(async ({ text }) => {
          const result = await xml2js.parseStringPromise(text, { explicitArray: false });
          const { entity } = result.data.entities;
          entity.$.id.should.be.eql('12345678-1234-4123-8234-123456789abc');
          entity.deleted.should.be.eql('true');
        });
    }));
  });
});
