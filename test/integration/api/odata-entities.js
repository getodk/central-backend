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

        await user.patch(`/v1/projects/1/forms/simpleEntity/submissions/submission${i+skip}`)
          .send({ reviewState: 'approved' })
          .expect(200);

      }
      await exhaust(container);
    };
    /* eslint-enable no-await-in-loop*/

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

      await container.run(sql`UPDATE entities SET "createdAt" = '2020-01-01'`);

      await createSubmissions(asAlice, container, 2, 2);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$select=__id')
        .expect(200)
        .then(({ body }) => {
          body.value.length.should.be.eql(4);
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
        </EntitySet>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`);
        });
    }));
  });
});
