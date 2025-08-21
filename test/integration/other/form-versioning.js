const appPath = require('app-root-path');
const should = require('should');
const { testService } = require('../setup');
const testData = require('../../data/xml');
const { Blob, Form } = require(appPath + '/lib/model/frames');

describe('form forward versioning', () => {
  const force = (x) => x.get();
  const newXml = testData.forms.simple.replace('id="simple"', 'id="simple" version="two"');

  it('should create a new def and update the version', testService((_, { Forms }) =>
    Promise.all([
      Form.fromXml(newXml),
      Forms.getByProjectAndXmlFormId(1, 'simple').then(force)
    ])
      // eslint-disable-next-line no-multi-spaces
      .then(([ partial, oldForm ]) =>  Forms.createVersion(partial, oldForm, true))
      .then(() => Forms.getByProjectAndXmlFormId(1, 'simple', true)).then(force)
      .then((newForm) => {
        newForm.currentDefId.should.equal(newForm.def.id);
        /version="two"/.test(newForm.xml).should.equal(true);
        newForm.def.sha.should.equal('5a31610cb649ccd2482709664e2a6268df66112f');
      })));

  it('should create a new draft def and not update the current version', testService((_, { Forms }) =>
    Promise.all([
      Form.fromXml(newXml),
      Forms.getByProjectAndXmlFormId(1, 'simple').then(force)
    ])
      .then(([ partial, oldForm ]) => Forms.createVersion(partial, oldForm, false)
        .then(() => Forms.getByProjectAndXmlFormId(1, 'simple', true)).then(force)
        .then((newForm) => {
          newForm.currentDefId.should.equal(oldForm.def.id);
          /version="two"/.test(newForm.xml).should.equal(false);
          newForm.def.sha.should.equal('6f3b4ee76e0ac9a1e2007ef987be40e02c24d75e');

          should.exist(newForm.draftDefId);
          newForm.draftDefId.should.not.equal(newForm.def.id);
        }))));

  it('should preserve submissions', testService((service, { Forms }) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one)
        .set('Content-Type', 'text/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.two)
          .set('Content-Type', 'text/xml')
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.three)
          .set('Content-Type', 'text/xml')
          .expect(200))
        .then(() => Promise.all([
          Form.fromXml(newXml),
          Forms.getByProjectAndXmlFormId(1, 'simple').then(force)
        ])
          .then(([ partial, form ]) => Forms.createVersion(partial, form, true))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(3);
              body.map((row) => row.instanceId).should.eql([ 'three', 'two', 'one' ]);
            }))))));

  const withAttachmentsMatching = testData.forms.withAttachments
    .replace('id="withAttachments"', 'id="withAttachments" version="two"');
  it('should copy forward matching attachments', testService((_, { Blobs, Forms, FormAttachments, Projects }) =>
    Promise.all([
      Projects.getById(1).then(force),
      Form.fromXml(testData.forms.withAttachments),
      Blob.fromFile(__filename).then(Blobs.ensure)
    ])
      .then(([ project, partial, blobId ]) => Forms.createNew(partial, project)
        .then((formDraft) => Forms.publish(formDraft, true))
        .then((savedForm) => Promise.all([ 'goodone.csv', 'goodtwo.mp3' ]
          .map((name) => FormAttachments.getByFormDefIdAndName(savedForm.def.id, name)
            .then(force)
            .then((attachment) => FormAttachments.update(savedForm, attachment, blobId)))
        ) // eslint-disable-line function-paren-newline
          .then(() => Form.fromXml(withAttachmentsMatching))
          // eslint-disable-next-line no-shadow
          .then((partial) => Forms.createVersion(partial, savedForm, true))
          // eslint-disable-next-line newline-per-chained-call
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withAttachments')).then(force)
          .then((finalForm) => FormAttachments.getAllByFormDefId(finalForm.currentDefId)
            .then((attachments) => {
              savedForm.currentDefId.should.not.equal(finalForm.currentDefId);

              attachments.length.should.equal(2);
              attachments[0].formId.should.equal(finalForm.id);
              attachments[1].formId.should.equal(finalForm.id);
              attachments[0].formDefId.should.equal(finalForm.currentDefId);
              attachments[1].formDefId.should.equal(finalForm.currentDefId);

              attachments[0].blobId.should.equal(blobId);
              attachments[1].blobId.should.equal(blobId);
            }))))));

  const withAttachmentsNonmatching = withAttachmentsMatching
    .replace('goodone.csv', 'reallygoodone.csv') // name change
    .replace('form="audio"', 'form="video"'); // type change
  it('should not copy forward nonmatching attachments', testService((_, { Blobs, Forms, FormAttachments, Projects }) =>
    Promise.all([
      Projects.getById(1).then(force),
      Form.fromXml(testData.forms.withAttachments),
      Blob.fromFile(__filename).then(Blobs.ensure)
    ])
      .then(([ project, partial, blobId ]) => Forms.createNew(partial, project)
        .then((formDraft) => Forms.publish(formDraft, true))
        .then((savedForm) => Promise.all([ 'goodone.csv', 'goodtwo.mp3' ]
          .map((name) => FormAttachments.getByFormDefIdAndName(savedForm.def.id, name)
            .then(force)
            .then((attachment) => FormAttachments.update(savedForm, attachment, blobId)))
        ) // eslint-disable-line function-paren-newline
          .then(() => Form.fromXml(withAttachmentsNonmatching))
          .then((partial2) => Forms.createVersion(partial2, savedForm, true))
          // eslint-disable-next-line newline-per-chained-call
          .then(() => Forms.getByProjectAndXmlFormId(1, 'withAttachments')).then(force)
          .then((finalForm) => FormAttachments.getAllByFormDefId(finalForm.currentDefId)
            .then((attachments) => {
              attachments.length.should.equal(2);
              should.not.exist(attachments[0].blobId);
              should.not.exist(attachments[1].blobId);

              attachments[0].type.should.equal('video'); // n.b. the order swaps because r > g
              attachments[1].name.should.equal('reallygoodone.csv');
            }))))));
});

