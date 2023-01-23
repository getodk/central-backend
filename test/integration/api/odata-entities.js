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
const { identity } = require('ramda');
const { exhaust } = require('../../../lib/worker/worker');
const { v4: uuid } = require('uuid');

describe('api: /datasets/:name.svc', () => {
  describe('GET /Entities', () => {

    /* eslint-disable no-await-in-loop*/
    const createSubmissions = async (user, container, count = 1) => {
      for (let i = 0; i < count; i += 1) {
        await user.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one
            .replace(/one/g, `submission${i}`)
            .replace('uuid:12345678-1234-4123-8234-123456789abc', uuid()))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await user.patch(`/v1/projects/1/forms/simpleEntity/submissions/submission${i}`)
          .send({ reviewState: 'approved' })
          .expect(200);

      }
      await exhaust(container);
    };
    /* eslint-enable no-await-in-loop*/

    it('should return all entities', testService(async (service, container) => {
      const asAlice = await service.login('alice', identity);

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities')
        .expect(200)
        .then(({ body }) => {
          body.value.length.should.be.eql(2);
        });
    }));

    it('should return count of entities', testService(async (service, container) => {
      const asAlice = await service.login('alice', identity);

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


    it('should return only second entity', testService(async (service, container) => {
      const asAlice = await service.login('alice', identity);

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
      const asAlice = await service.login('alice', identity);

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await createSubmissions(asAlice, container, 2);

      await asAlice.get('/v1/projects/1/datasets/people.svc/Entities?$top=1')
        .expect(200)
        .then(({ body }) => {
          body['@odata.nextLink'].should.be.equal('http://localhost:8989/v1/projects/1/datasets/people.svc/Entities?%24skip=1');
        });
    }));
  });
});
