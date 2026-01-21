const appRoot = require('app-root-path');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');
const { exhaust } = require(appRoot + '/lib/worker/worker');

describe('select many value processing', () => {
  it('should process values on submission ingest', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.selectMultiple)
        .set('Content-Type', 'text/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
          .send(testData.instances.selectMultiple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => exhaust(container)))
        .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
          .send(testData.instances.selectMultiple.two)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => exhaust(container)))
        .then(() => Promise.all([
          container.all(sql`select * from form_field_values`),
          container.one(sql`select id, "currentDefId" from forms where "xmlFormId"='selectMultiple'`)
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
        .send(testData.forms.selectMultiple)
        .set('Content-Type', 'text/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
          .send(testData.instances.selectMultiple.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => exhaust(container)))
        .then(() => asAlice.put('/v1/projects/1/forms/selectMultiple/submissions/one')
          .send(testData.instances.selectMultiple.one
            .replace('x y z', 'xyz')
            .replace('one</instanceID>', 'one2</instanceID><deprecatedID>one</deprecatedID>'))
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => exhaust(container)))
        .then(() => Promise.all([
          container.all(sql`select * from form_field_values`),
          container.one(sql`select id, "currentDefId" from forms where "xmlFormId"='selectMultiple'`)
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

  it('should handle when field changes from select1 to select (selectMultiple)', testService(async (service, container) => {
    const asAlice = await service.login('alice');

    // the select1 version of forms.selectMultple
    const selectOne = `<?xml version="1.0"?>
      <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
        <h:head>
          <model>
            <instance>
              <data id="selectMultiple">
                <meta><instanceID/></meta>
                <q1/>
                <g1><q2/></g1>
              </data>
            </instance>
            <bind nodeset="/data/meta/instanceID" type="string"/>
            <bind nodeset="/data/q1" type="string"/>
            <bind nodeset="/data/g1/q2" type="string"/>
          </model>
        </h:head>
        <h:body>
          <select1 ref="/data/q1"><label>one</label></select1>
          <group ref="/data/g1">
            <label>group</label>
            <select1 ref="/data/g1/q2"><label>two</label></select1>
          </group>
        </h:body>
      </h:html>`;

    await asAlice.post('/v1/projects/1/forms?publish=true')
      .send(selectOne)
      .set('Content-Type', 'application/xml')
      .expect(200);

    // <q1>b</q1><g1><q2>x</q2></g1>
    await asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
      .send(testData.instances.selectMultiple.two.replace('m x', 'x')) // just send one value for each field
      .set('Content-Type', 'application/xml')
      .expect(200);

    // upload new version of form where select multiple is now allowed
    await asAlice.post('/v1/projects/1/forms/selectMultiple/draft')
      .set('Content-Type', 'application/xml')
      .send(testData.forms.selectMultiple)
      .expect(200);

    await asAlice.post('/v1/projects/1/forms/selectMultiple/draft/publish?version=2')
      .expect(200);

    //<q1>a b</q1><g1><q2>x y z</q2></g1>
    await asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
      .send(testData.instances.selectMultiple.one.replace('id="selectMultiple"', 'id="selectMultiple" version="2"'))
      .set('Content-Type', 'text/xml')
      .expect(200);

    await exhaust(container);

    await asAlice.get('/v1/projects/1/forms/selectMultiple/submissions.csv?splitSelectMultiples=true')
      .expect(200)
      .then(({ text }) => {
        const lines = text.split('\n');
        lines[0].should.equal('SubmissionDate,meta-instanceID,q1,q1/a,q1/b,g1-q2,g1-q2/x,g1-q2/y,g1-q2/z,KEY,SubmitterID,SubmitterName,AttachmentsPresent,AttachmentsExpected,Status,ReviewState,DeviceID,Edits,FormVersion');
        lines[1].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
          .should.equal(',one,a b,1,1,x y z,1,1,1,one,5,Alice,0,0,,,,0,2');
        lines[2].slice('yyyy-mm-ddThh:mm:ss._msZ'.length)
          .should.equal(',two,b,0,1,x,1,0,0,two,5,Alice,0,0,,,,0,');
      });
  }));
});

