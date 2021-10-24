const appRoot = require('app-root-path');
const should = require('should');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');
const { exhaust } = require(appRoot + '/lib/worker/worker');

describe('select many value processing', () => {
  it('should process values on submission ingest', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.selectMany)
        .set('Content-Type', 'text/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/selectMany/submissions')
          .send(testData.instances.selectMany.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => exhaust(container)))
        .then(() => asAlice.post('/v1/projects/1/forms/selectMany/submissions')
          .send(testData.instances.selectMany.two)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => exhaust(container)))
        .then(() => Promise.all([
          container.all(sql`select * from form_field_values`),
          container.one(sql`select id, "currentDefId" from forms where "xmlFormId"='selectMany'`)
            .then(({ id, currentDefId }) => Promise.all([
              container.oneFirst(sql`select id from submission_defs where "formDefId"=${currentDefId} and "instanceId"='one'`),
              container.oneFirst(sql`select id from submission_defs where "formDefId"=${currentDefId} and "instanceId"='two'`)
            ])
              .then(([ one, two ]) => [ id, one, two ]))
        ]))
        .then(([ values, [ formId, one, two ] ]) => {
          values.should.eql([
            { formId, submissionDefId: one, path: '/q1', value: 'a' },
            { formId, submissionDefId: one, path: '/q1', value: 'b' },
            { formId, submissionDefId: one, path: '/g1/q2', value: 'x' },
            { formId, submissionDefId: one, path: '/g1/q2', value: 'y' },
            { formId, submissionDefId: one, path: '/g1/q2', value: 'z' },
            { formId, submissionDefId: two, path: '/q1', value: 'b' },
            { formId, submissionDefId: two, path: '/g1/q2', value: 'm' },
            { formId, submissionDefId: two, path: '/g1/q2', value: 'x' }
          ]);
        }))));

  it('should update values on submission update', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.selectMany)
        .set('Content-Type', 'text/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/selectMany/submissions')
          .send(testData.instances.selectMany.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => exhaust(container)))
        .then(() => asAlice.put('/v1/projects/1/forms/selectMany/submissions/one')
          .send(testData.instances.selectMany.one
            .replace('x y z', 'xyz')
            .replace('one</instanceID>', 'one2</instanceID><deprecatedID>one</deprecatedID>'))
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => exhaust(container)))
        .then(() => Promise.all([
          container.all(sql`select * from form_field_values`),
          container.one(sql`select id, "currentDefId" from forms where "xmlFormId"='selectMany'`)
            .then(({ id, currentDefId }) => Promise.all([
              container.oneFirst(sql`select id from submission_defs where "formDefId"=${currentDefId} and "instanceId"='one'`),
              container.oneFirst(sql`select id from submission_defs where "formDefId"=${currentDefId} and "instanceId"='one2'`)
            ])
              .then(([ one, two ]) => [ id, one, two ]))
        ]))
        .then(([ values, [ formId, one, one2 ] ]) => {
          values.should.eql([
            { formId, submissionDefId: one, path: '/q1', value: 'a' },
            { formId, submissionDefId: one, path: '/q1', value: 'b' },
            { formId, submissionDefId: one, path: '/g1/q2', value: 'x' },
            { formId, submissionDefId: one, path: '/g1/q2', value: 'y' },
            { formId, submissionDefId: one, path: '/g1/q2', value: 'z' },
            { formId, submissionDefId: one2, path: '/q1', value: 'a' },
            { formId, submissionDefId: one2, path: '/q1', value: 'b' },
            { formId, submissionDefId: one2, path: '/g1/q2', value: 'xyz' }
          ]);
        }))));
});

