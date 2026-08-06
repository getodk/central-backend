// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { testService } = require('../setup');
const testData = require('../../data/xml');
const { exhaust } = require('../../../lib/worker/worker');
const { v4: uuid } = require('uuid');
const { sql } = require('slonik');
const { QueryOptions } = require('../../../lib/util/db');
const should = require('should');

describe('api: /datasets/:name.svc', () => {
  describe('GET /Entities', () => {
    /* eslint-disable no-await-in-loop*/
    const createSubmissions = async (user, container, count = 1, skip = 0) => {
      for (let i = 0; i < count; i += 1) {
        await user.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one
            .replace(/one/g, `submission${i+skip}`)
            .replace(/88/g, i + skip + 1)
            .replace('uuid:12345678-1234-4123-8234-123456789abc', uuid()))
          .set('Content-Type', 'application/xml')
          .expect(200);
      }
      await exhaust(container);
    };
    /* eslint-enable no-await-in-loop*/

    const createConflict = async (user, container) => {
      await user.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      await user.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc?force=true')
        .send({ data: { age: '99' } })
        .expect(200);

      await user.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.updateEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // all properties changed
      await user.post('/v1/projects/1/forms/updateEntity/submissions')
        .send(testData.instances.updateEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);
    };

    const createEntity = async (user, datasetName, label) => {
      await user.post(`/v1/projects/1/datasets/${datasetName}/entities`)
        .send({
          uuid: uuid(),
          label
        })
        .expect(200);
    };

    it('should return all entities', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities')
        .expect(200)
        .then(({ body }) => {
          body.value.length.should.be.eql(2);

          body.value.forEach((r, i) => {
            r.first_name.should.be.eql('Alice');
            r.age.should.be.eql((2 - i).toString());
          });

          body.value[0].__id.should.not.be.eql(body.value[1].__id);
        });
    }));

    it('should return entity data that matches spec', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 1);

      await createConflict(asAlice, container);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities')
        .expect(200)
        .then(({ body }) => {
          const entity = body.value[0];

          // properties
          entity.first_name.should.equal('Alicia');
          entity.age.should.equal('85');

          // label
          entity.label.should.equal('Alicia (85)');

          // id
          entity.__id.should.equal('12345678-1234-4123-8234-123456789abc');

          // metadata/__system data
          // if any of these change, they should also be updated in the emdx template
          entity.should.have.property('__system');
          entity.__system.creatorId.should.equal('5');
          entity.__system.creatorName.should.equal('Alice');
          entity.__system.createdAt.should.be.a.recentIsoDate();
          entity.__system.updatedAt.should.be.a.recentIsoDate();
          entity.__system.updates.should.equal(2);
          entity.__system.version.should.equal(3);
          entity.__system.conflict.should.equal('hard');
        });
    }));

    it('should return count of entities', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$count=true')
        .expect(200)
        .then(({ body }) => {
          body['@odata.count'].should.be.eql(2);
        });
    }));

    it('should return count of entities not the entity_defs', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      const uuids = await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$count=true')
        .expect(200)
        .then(({ body }) => {
          body['@odata.count'].should.be.eql(2);
          return body.value.map(e => e.__id);
        });

      await asAlice.patch(`/v1/projects/1/datasets/people/entities/${uuids[0]}?force=true`)
        .send({
          label: 'changed'
        })
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$count=true')
        .expect(200)
        .then(({ body }) => {
          body['@odata.count'].should.be.eql(2);
        });
    }));

    it('should return count of filtered entities', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      await container.run(sql`UPDATE entities SET "createdAt" = '2020-01-01'`);

      await createSubmissions(asAlice, container, 2, 2);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$filter=__system/createdAt gt 2021-01-01&$count=true')
        .expect(200)
        .then(({ body }) => {
          body['@odata.count'].should.be.eql(2);
        });
    }));

    it('should return only second entity', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$top=1&$skip=1')
        .expect(200)
        .then(({ body }) => {
          body.value.length.should.be.equal(1);
        });
    }));

    it('should return nextURL', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$top=1')
        .expect(200)
        .then(({ body }) => {
          const tokenData = {
            uuid: body.value[0].__id,
          };
          const token = encodeURIComponent(QueryOptions.getSkiptoken(tokenData));
          body['@odata.nextLink'].should.be.equal(`http://localhost:8989/v1/projects/1/datasets/people.svc/Entities?%24top=1&%24skiptoken=${token}`);
        });
    }));

    it('should not duplicate or skip entities - opaque cursor', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      const nextlink = await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$top=1&$count=true')
        .expect(200)
        .then(({ body }) => {
          body.value[0].age.should.be.eql('2');
          const tokenData = {
            uuid: body.value[0].__id,
          };
          const token = encodeURIComponent(QueryOptions.getSkiptoken(tokenData));
          body['@odata.nextLink'].should.be.equal(`http://localhost:8989/v1/projects/1/datasets/people.svc/Entities?%24top=1&%24count=true&%24skiptoken=${token}`);
          body['@odata.count'].should.be.eql(2);
          return body['@odata.nextLink'];
        });

      // create of these 2 entities have no impact on the nextlink
      await createSubmissions(asAlice, container, 2, 2);

      await asAlice.get(nextlink.replace('http://localhost:8989', ''))
        .expect(200)
        .then(({ body }) => {
          body.value[0].age.should.be.eql('1');
          body['@odata.count'].should.be.eql(4);
          should.not.exist(body['@odata.nextLink']);
        });
    }));

    it('should not return deleted entities - opaque cursor', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 5);

      const uuids = await asAlice.get('/v1/projects/1/datasets/people/entities')
        .then(({ body }) => body.map(e => e.uuid));

      const nextlink = await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$top=2&$count=true')
        .expect(200)
        .then(({ body }) => {
          body.value[0].age.should.be.eql('5');
          body.value[1].age.should.be.eql('4');
          const tokenData = {
            uuid: body.value[1].__id,
          };
          const token = encodeURIComponent(QueryOptions.getSkiptoken(tokenData));
          body['@odata.nextLink'].should.be.equal(`http://localhost:8989/v1/projects/1/datasets/people.svc/Entities?%24top=2&%24count=true&%24skiptoken=${token}`);
          body['@odata.count'].should.be.eql(5);
          return body['@odata.nextLink'];
        });

      // let's delete entities
      await asAlice.delete(`/v1/projects/1/datasets/people/entities/${uuids[0]}`)
        .expect(200);
      await asAlice.delete(`/v1/projects/1/datasets/people/entities/${uuids[2]}`)
        .expect(200);
      await asAlice.delete(`/v1/projects/1/datasets/people/entities/${uuids[4]}`)
        .expect(200);

      await asAlice.get(nextlink.replace('http://localhost:8989', ''))
        .expect(200)
        .then(({ body }) => {
          body.value[0].age.should.be.eql('2');
          body['@odata.count'].should.be.eql(2);
          should.not.exist(body['@odata.nextLink']);
        });


    }));

    describe('filtering deleted entities', () => {
      const filtering = (idxOffset, description, filter) => it(description, testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simpleEntity)
          .expect(200);

        await createSubmissions(asAlice, container, 5);

        const uuids = await asAlice.get('/v1/projects/1/datasets/people/entities')
          .then(({ body }) => body.map(e => e.uuid));

        // let's delete entities
        await asAlice.delete(`/v1/projects/1/datasets/people/entities/${uuids[0]}`)
          .expect(200);
        await asAlice.delete(`/v1/projects/1/datasets/people/entities/${uuids[2]}`)
          .expect(200);
        await asAlice.delete(`/v1/projects/1/datasets/people/entities/${uuids[4]}`)
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$filter=' + filter)
          .expect(200)
          .then(({ body }) => {
            for (const [index, value] of body.value.entries()) {
              value.__id.should.be.eql(uuids[index*2 + idxOffset]);
            }
          });
      }));

      filtering(1, 'should support equality with standard notation',   '__system/deletedAt eq null'); // eslint-disable-line no-multi-spaces
      filtering(1, 'should support equality with yoda notation',       'null eq __system/deletedAt'); // eslint-disable-line no-multi-spaces
      filtering(0, 'should support inequality with standard notation', '__system/deletedAt ne null');
      filtering(0, 'should support inequality with yoda notation',     'null ne __system/deletedAt'); // eslint-disable-line no-multi-spaces
    });

    it('should return filtered entities', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      await container.run(sql`UPDATE entities SET "createdAt" = '2020-01-01'`);

      await createSubmissions(asAlice, container, 2, 2);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$filter=__system/createdAt gt 2021-01-01')
        .expect(200)
        .then(({ body }) => {
          body.value.length.should.be.eql(2);
        });
    }));

    it('should allow filtering by UUID', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      const entityUuids = await container.allFirst(sql`SELECT uuid FROM entities`);
      entityUuids.length.should.eql(2);

      for (const id of entityUuids) {
        await asAlice.get(`/v1/projects/1/datasets/people.svc/Entities?$filter=__id eq '${id}'`) // eslint-disable-line no-await-in-loop
          .expect(200)
          .then(({ body }) => {
            body.value.length.should.eql(1);

            const [ val ] = body.value;
            Object.keys(val).should.eqlInAnyOrder([ '__id', 'label', '__system', 'first_name', 'age' ]);
            val.__id.should.eql(id);
            val.__system.createdAt.should.be.an.isoDate();
          });
      }
    }));

    it('should return only searched entities', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createEntity(asAlice, 'people', 'John Doe');
      await createEntity(asAlice, 'people', 'Jane Doe');

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$search=john')
        .expect(200)
        .then(({ body }) => {
          body.value.length.should.be.eql(1);
          body.value[0].label.should.be.eql('John Doe');
        });
    }));

    it('should return only searched and filtered entities', testService(async (service) => {
      const asAlice = await service.login('alice');
      const asBob = await service.login('bob');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createEntity(asAlice, 'people', 'John Doe');
      await createEntity(asAlice, 'people', 'Jane Doe');
      await createEntity(asBob, 'people', 'John Doe (r)');
      await createEntity(asBob, 'people', 'Jane Doe (r)');

      const bobId = await asBob.get('/v1/users/current').then(({ body }) => body.id);

      await asAlice.get(`/v1/projects/1/datasets/people.svc/Entities?$search=john&$filter=__system/creatorId eq ${bobId}`)
        .expect(200)
        .then(({ body }) => {
          body.value.length.should.be.eql(1);
          body.value[0].label.should.be.eql('John Doe (r)');
        });
    }));

    it('should return only searched entities with pagination', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createEntity(asAlice, 'people', 'John Doe');
      await createEntity(asAlice, 'people', 'Jane Doe');
      await createEntity(asAlice, 'people', 'John Doe (r)');
      await createEntity(asAlice, 'people', 'Jane Doe (r)');

      const nextlink = await asAlice.get(`/v1/projects/1/datasets/people.svc/Entities?$top=1&$search=john`)
        .expect(200)
        .then(({ body }) => {
          body.value.length.should.be.eql(1);
          body.value[0].label.should.be.eql('John Doe (r)');
          return body['@odata.nextLink'];
        });

      await asAlice.get(nextlink.replace('http://localhost:8989', ''))
        .expect(200)
        .then(({ body }) => {
          body.value[0].label.should.be.eql('John Doe');
          should.not.exist(body['@odata.nextLink']);
        });
    }));

    it('should filter by conflict status', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      await createConflict(asAlice, container);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$filter=__system/conflict eq \'hard\'')
        .expect(200)
        .then(({ body }) => {
          body.value.length.should.be.eql(1);

          body.value[0].__system.conflict.should.be.eql('hard');
        });
    }));

    it('should NOT filter by label', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$filter=label eq \'Alice\'')
        .expect(501)
        .then(({ body }) => {
          body.message.should.eql('The given OData filter expression references fields not supported by this server: label at 0');
        });
    }));

    it('should NOT filter by name/uuid', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$filter=uuid eq \'1234\'')
        .expect(501)
        .then(({ body }) => {
          body.message.should.eql('The given OData filter expression references fields not supported by this server: uuid at 0');
        });

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$filter=name eq \'1234\'')
        .expect(501)
        .then(({ body }) => {
          body.message.should.eql('The given OData filter expression references fields not supported by this server: name at 0');
        });
    }));

    it('should return filtered entities with pagination', testService(async (service, container) => {
      const asAlice = await service.login('alice');
      const asBob = await service.login('bob');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      await createSubmissions(asBob, container, 2, 2);

      const bobId = await asBob.get('/v1/users/current').then(({ body }) => body.id);

      const nextlink = await asAlice.get(`/v1/projects/1/datasets/people.svc/Entities?$top=1&$filter=__system/creatorId eq ${bobId}`)
        .expect(200)
        .then(({ body }) => {
          body.value.length.should.be.eql(1);
          body.value[0].age.should.be.eql('4');
          return body['@odata.nextLink'];
        });

      await asAlice.get(nextlink.replace('http://localhost:8989', ''))
        .expect(200)
        .then(({ body }) => {
          body.value[0].age.should.be.eql('3');
          should.not.exist(body['@odata.nextLink']);
        });
    }));

    it('should throw error if filter criterion is invalid', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$filter=first_name eq Alice')
        .expect(501)
        .then(({ body }) => {
          body.message.should.be.eql('The given OData filter expression references fields not supported by this server: first_name at 0');
        });
    }));

    it('should return selected properties only', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$select=__id')
        .expect(200)
        .then(({ body }) => {
          body.value.map((e) => Object.keys(e).should.eql(['__id']));
          body.value.length.should.be.eql(2);
        });
    }));

    it('should return selected user-defined only', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$select=age')
        .expect(200)
        .then(({ body }) => {
          body.value.map((e) => Object.keys(e).should.eql(['age']));
          body.value.length.should.be.eql(2);
        });
    }));

    it('should return update count and updatedAt', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      const firstEntity = await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$top=1')
        .expect(200)
        .then(({ body }) => body.value[0]);

      await asAlice.patch(`/v1/projects/1/datasets/people/entities/${firstEntity.__id}?force=true`)
        .send({ data: { age: '22' } })
        .expect(200);

      await asAlice.patch(`/v1/projects/1/datasets/people/entities/${firstEntity.__id}?force=true`)
        .send({ data: { age: '44' } })
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities')
        .expect(200)
        .then(({ body }) => {
          body.value.length.should.be.eql(2);

          body.value.forEach(r => {
            r.__system.should.have.property('updatedAt').which.is.nullOrIsoDate();
            r.__system.should.have.property('updates').which.is.a.Number();
          });

          body.value[0].__system.updates.should.be.eql(2);
          body.value[1].__system.updates.should.be.eql(0);
        });
    }));

    it('should filter by updatedAt', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      const lastEntity = await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$top=1')
        .expect(200)
        .then(({ body }) => body.value[0]);

      await asAlice.patch(`/v1/projects/1/datasets/people/entities/${lastEntity.__id}?force=true`)
        .send({ data: { age: '22' } })
        .expect(200);

      await asAlice.get(`/v1/projects/1/datasets/people.svc/Entities?$filter=__system/updatedAt gt ${lastEntity.__system.createdAt}`)
        .expect(200)
        .then(({ body }) => {
          body.value.length.should.be.eql(1);
          body.value[0].__system.updates.should.be.eql(1);
          body.value[0].__system.updatedAt.should.be.greaterThan(lastEntity.__system.createdAt);
          body.value[0].__id.should.be.eql(lastEntity.__id);

        });
    }));

    it('should return entities in specified order', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 3);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$orderby=__system/createdAt asc')
        .expect(200)
        .then(({ body }) => {
          body.value.map((e) => e.age).should.eql(['1', '2', '3']);
          body.value[0].__system.createdAt.should.be.lessThan(body.value[2].__system.createdAt);
        });

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$orderby=__system/createdAt desc')
        .expect(200)
        .then(({ body }) => {
          body.value.map((e) => e.age).should.eql(['3', '2', '1']);
          body.value[0].__system.createdAt.should.be.greaterThan(body.value[2].__system.createdAt);
        });
    }));

    it('should return entities with order specified in multiple clauses', testService(async (service, container) => {
      const asAlice = await service.login('alice');
      const asBob = await service.login('bob');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);
      await createSubmissions(asBob, container, 2, 2);
      await createSubmissions(asAlice, container, 2, 4);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$orderby=__system/creatorId desc, __system/createdAt asc')
        .expect(200)
        .then(({ body }) => {
          body.value.map((e) => e.__system.creatorId).should.eql(['6', '6', '5', '5', '5', '5']);
          body.value.map((e) => e.age).should.eql(['3', '4', '1', '2', '5', '6']);
        });
    }));

    it('should return entities in stable order', testService(async (service, container) => {
      const asAlice = await service.login('alice');
      const asBob = await service.login('bob');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);
      await createSubmissions(asBob, container, 2, 2);
      await createSubmissions(asAlice, container, 2, 4);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$orderby=__system/creatorId desc')
        .expect(200)
        .then(({ body }) => {
          body.value.map((e) => e.__system.creatorId).should.eql(['6', '6', '5', '5', '5', '5']);
          body.value.map((e) => e.age).should.eql(['4', '3', '6', '5', '2', '1']);
        });

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$orderby=__system/creatorId asc')
        .expect(200)
        .then(({ body }) => {
          body.value.map((e) => e.__system.creatorId).should.eql(['5', '5', '5', '5', '6', '6']);
          body.value.map((e) => e.age).should.eql(['1', '2', '5', '6', '3', '4']);
        });
    }));

    it('should return sorted null values in the correct order', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);
      await createConflict(asAlice, container);

      // Default sort order is asc
      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$orderby=__system/conflict')
        .expect(200)
        .then(({ body }) => {
          body.value.map((e) => e.__system.conflict).should.eql([ null, null, 'hard' ]);
        });

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$orderby=__system/conflict asc')
        .expect(200)
        .then(({ body }) => {
          body.value.map((e) => e.__system.conflict).should.eql([ null, null, 'hard' ]);
        });


      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$orderby=__system/conflict desc')
        .expect(200)
        .then(({ body }) => {
          body.value.map((e) => e.__system.conflict).should.eql([ 'hard', null, null ]);
        });
    }));

    it('should return sorted null values in the correct order in any clause', testService(async (service, container) => {
      const asAlice = await service.login('alice');
      const asBob = await service.login('bob');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);
      await createSubmissions(asBob, container, 2, 2);
      await createConflict(asAlice, container);

      // Default sort order is asc
      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$orderby=__system/creatorId asc,__system/conflict')
        .expect(200)
        .then(({ body }) => {
          body.value.map((e) => e.__system.creatorId).should.eql(['5', '5', '5', '6', '6']);
          body.value.map((e) => e.__system.conflict).should.eql([ null, null, 'hard', null, null ]);
        });

      // Default sort order is asc
      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$orderby=__system/creatorId asc,__system/conflict asc')
        .expect(200)
        .then(({ body }) => {
          body.value.map((e) => e.__system.creatorId).should.eql(['5', '5', '5', '6', '6']);
          body.value.map((e) => e.__system.conflict).should.eql([ null, null, 'hard', null, null ]);
        });

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$orderby=__system/creatorId asc,__system/conflict desc')
        .expect(200)
        .then(({ body }) => {
          body.value.map((e) => e.__system.creatorId).should.eql(['5', '5', '5', '6', '6']);
          body.value.map((e) => e.__system.conflict).should.eql([ 'hard', null, null, null, null ]);
        });

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$orderby=__system/creatorId desc,__system/conflict desc')
        .expect(200)
        .then(({ body }) => {
          body.value.map((e) => e.__system.creatorId).should.eql(['6', '6', '5', '5', '5']);
          body.value.map((e) => e.__system.conflict).should.eql([ null, null, 'hard', null, null ]);
        });
    }));

    it('should combine orderby with other filters', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      const lastEntity = await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$top=1')
        .expect(200)
        .then(({ body }) => body.value[0]);

      await createSubmissions(asAlice, container, 4, 2);

      await asAlice.get(`/v1/projects/1/datasets/people.svc/Entities?$orderby=__system/createdAt desc&$filter=__system/createdAt gt ${lastEntity.__system.createdAt}`)
        .expect(200)
        .then(({ body }) => {
          body.value.length.should.eql(4);
          body.value[0].__system.createdAt.should.be.greaterThan(body.value[3].__system.createdAt);
        });

      await asAlice.get(`/v1/projects/1/datasets/people.svc/Entities?$orderby=__system/createdAt asc&$filter=__system/createdAt gt ${lastEntity.__system.createdAt}`)
        .expect(200)
        .then(({ body }) => {
          body.value.length.should.eql(4);
          body.value[0].__system.createdAt.should.be.lessThan(body.value[3].__system.createdAt);
        });
    }));

    it('should reject if orderby used with skiptoken', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      const token = await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$top=1')
        .expect(200)
        .then(({ body }) => {
          const tokenData = {
            uuid: body.value[0].__id,
          };
          return encodeURIComponent(QueryOptions.getSkiptoken(tokenData));
        });

      await asAlice.get(`/v1/projects/1/datasets/people.svc/Entities?$orderby=__system/createdAt desc&%24skiptoken=${token}`)
        .expect(501)
        .then(({ body }) => {
          body.message.should.be.eql('The requested feature using $orderby and $skiptoken together is not supported by this server.');
        });
    }));
  });

  describe('GET service document', () => {
    it('should return service document', testService(async (service) => {

      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/people.svc')
        .expect(200)
        .then(({ body }) => {
          body.should.be.eql({
            '@odata.context': 'http://localhost:8989/v1/projects/1/datasets/people.svc/$metadata',
            value: [
              {
                name: 'Entities',
                kind: 'EntitySet',
                url: 'Entities',
              },
            ],
          });
        });
    }));

    it('should return metadata document', testService(async (service) => {

      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity.replace(/age/g, 'the.age'))
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/people.svc/$metadata')
        .expect(200)
        .then(({ text }) => {
          text.should.be.eql(`<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.entity">
      <ComplexType Name="metadata">
        <Property Name="createdAt" Type="Edm.DateTimeOffset"/>
        <Property Name="creatorId" Type="Edm.String"/>
        <Property Name="creatorName" Type="Edm.String"/>        
        <Property Name="updates" Type="Edm.Int64"/>
        <Property Name="updatedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="deletedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="version" Type="Edm.Int64"/>
        <Property Name="conflict" Type="Edm.String"/>
      </ComplexType>
    </Schema>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.user.people">    
      <EntityType Name="Entities">
        <Key><PropertyRef Name="__id"/></Key>
        <Property Name="__id" Type="Edm.String"/>
        <Property Name="__system" Type="org.opendatakit.entity.metadata"/>
        <Property Name="label" Type="Edm.String"/>
        <Property Name="first_name" Type="Edm.String"/>
        <Property Name="the_age" Type="Edm.String"/>
      </EntityType>    
      <EntityContainer Name="people">      
        <EntitySet Name="Entities" EntityType="org.opendatakit.user.people.Entities">          
          <Annotation Term="Org.OData.Capabilities.V1.ConformanceLevel" EnumMember="Org.OData.Capabilities.V1.ConformanceLevelType/Minimal"/>
          <Annotation Term="Org.OData.Capabilities.V1.BatchSupported" Bool="false"/>
          <Annotation Term="Org.OData.Capabilities.V1.CountRestrictions">
            <Record><PropertyValue Property="Countable" Bool="true"/></Record>
          </Annotation>
          <Annotation Term="Org.OData.Capabilities.V1.FilterFunctions">
            <Record>
              <PropertyValue Property="NonCountableProperties">
                <Collection>
                  <String>eq</String>
                </Collection>
              </PropertyValue>
            </Record>
          </Annotation>
          <Annotation Term="Org.OData.Capabilities.V1.FilterFunctions">
            <Record>
              <PropertyValue Property="Filterable" Bool="true"/>
              <PropertyValue Property="RequiresFilter" Bool="false"/>
              <PropertyValue Property="NonFilterableProperties">
                <Collection>
                  <PropertyPath>first_name</PropertyPath>
                  <PropertyPath>the_age</PropertyPath>
                </Collection>
              </PropertyValue>
            </Record>
          </Annotation>
          <Annotation Term="Org.OData.Capabilities.V1.SortRestrictions">
            <Record><PropertyValue Property="Sortable" Bool="false"/></Record>
          </Annotation>
          <Annotation Term="Org.OData.Capabilities.V1.ExpandRestrictions">
            <Record><PropertyValue Property="Expandable" Bool="false"/></Record>
          </Annotation>
          <Annotation Term="Org.OData.Capabilities.V1.SearchRestrictions">
            <Record>
              <PropertyValue Property="Searchable" Bool="true" />
              <PropertyValue Property="UnsupportedExpressions">
              <Collection>
                <EnumMember>Org.OData.Capabilities.V1.SearchExpressions/And</EnumMember>
                <EnumMember>Org.OData.Capabilities.V1.SearchExpressions/Not</EnumMember>
                <EnumMember>Org.OData.Capabilities.V1.SearchExpressions/Group</EnumMember>
              </Collection>
            </PropertyValue>
            </Record>
          </Annotation>
        </EntitySet>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`);
        });
    }));
  });
});
