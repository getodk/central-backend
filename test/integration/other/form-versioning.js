const should = require('should');
const { pick } = require('ramda');
const { testService } = require('../setup');
const testData = require('../../data/xml');

describe('form forward versioning', () => {
  const force = (x) => x.get();
  const newXml = testData.forms.simple.replace('id="simple"', 'id="simple" version="two"');

  it('should create a new def and update the version', testService((_, { Project, Form, FormDef, FormPartial }) =>
    Promise.all([
      FormPartial.fromXml(newXml),
      Project.getById(1).then(force)
        .then((project) => project.getFormByXmlFormId('simple')).then(force)
    ])
      .then(([ partial, oldForm ]) => partial.createVersion(oldForm))
      .then(() => Project.getById(1)).then(force)
      .then((project) => project.getFormByXmlFormId('simple')).then(force)
      .then((newForm) => {
        newForm.currentDefId.should.equal(newForm.def.id);
        /version="two"/.test(newForm.def.xml).should.equal(true);
        newForm.def.sha.should.equal('5a31610cb649ccd2482709664e2a6268df66112f');
      })));

  it('should create a new def and not update the version', testService((_, { Project, Form, FormDef, FormPartial }) =>
    Promise.all([
      FormPartial.fromXml(newXml),
      Project.getById(1).then(force)
        .then((project) => project.getFormByXmlFormId('simple')).then(force)
    ])
      .then(([ partial, oldForm ]) => partial.createVersion(oldForm, false)
        .then(() => Project.getById(1)).then(force)
        .then((project) => project.getFormByXmlFormId('simple')).then(force)
        .then((newForm) => {
          newForm.currentDefId.should.equal(oldForm.def.id);
          /version="two"/.test(newForm.def.xml).should.equal(false);
          newForm.def.sha.should.equal('6f3b4ee76e0ac9a1e2007ef987be40e02c24d75e');
        })))); // TODO: actually assert that the new def actually exists.

  it('should set an identity transformation', testService((_, { db, Project, Form, FormDef, FormPartial }) =>
    Promise.all([
      FormPartial.fromXml(newXml),
      Project.getById(1).then(force)
        .then((project) => project.getFormByXmlFormId('simple')).then(force)
    ])
      .then(([ partial, oldForm ]) => partial.createVersion(oldForm))
      .then(() => Promise.all([
        Project.getById(1).then(force)
          .then((project) => project.getFormByXmlFormId('simple')).then(force),
        db.select('*').from('transformations').where({ system: 'identity' }).then(([ row ]) => row)
      ])
      .then(([ newForm, identityTransformation ]) => {
        newForm.def.transformationId.should.equal(identityTransformation.id);
      }))));

  it('should preserve submissions', testService((service, { Project, Blob, Form, FormDef, FormAttachment, FormPartial }) =>
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
          FormPartial.fromXml(newXml),
          Project.getById(1).then(force)
            .then((project) => project.getFormByXmlFormId('simple')).then(force)
        ])
        .then(([ partial, form ]) => partial.createVersion(form))
        .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(3);
            body.map((row) => row.instanceId).should.eql([ 'three', 'two', 'one' ]);
          }))))));

  const withAttachmentsMatching = testData.forms.withAttachments
    .replace('id="withAttachments"', 'id="withAttachments" version="two"');
  it('should copy forward matching attachments', testService((_, { Project, Blob, Form, FormDef, FormAttachment, FormPartial }) =>
    Promise.all([
      Project.getById(1).then(force),
      FormPartial.fromXml(testData.forms.withAttachments),
      Blob.fromFile(__filename).then((blob) => blob.create())
    ])
      .then(([ project, partial, blob ]) => partial.with({ projectId: project.id }).createNew()
        .then((savedForm) => Promise.all([ 'goodone.csv', 'goodtwo.mp3' ]
          .map((name) => FormAttachment.getByFormDefIdAndName(savedForm.def.id, name)
            .then(force)
            .then((attachment) => attachment.with({ blobId: blob.id }).update()))
        )
          .then(() => FormPartial.fromXml(withAttachmentsMatching))
          .then((partial) => partial.createVersion(savedForm))
          .then(() => project.getFormByXmlFormId('withAttachments')).then(force)
          .then((finalForm) => FormAttachment.getAllByFormDefId(finalForm.currentDefId)
            .then((attachments) => {
              savedForm.currentDefId.should.not.equal(finalForm.currentDefId);

              attachments.length.should.equal(2);
              attachments[0].formId.should.equal(finalForm.id);
              attachments[1].formId.should.equal(finalForm.id);
              attachments[0].formDefId.should.equal(finalForm.currentDefId);
              attachments[1].formDefId.should.equal(finalForm.currentDefId);

              attachments[0].blobId.should.equal(blob.id);
              attachments[1].blobId.should.equal(blob.id);
            }))))));

  const withAttachmentsNonmatching = withAttachmentsMatching
    .replace('goodone.csv', 'reallygoodone.csv') // name change
    .replace('form="audio"', 'form="video"'); // type change
  it('should not copy forward nonmatching attachments', testService((_, { Project, Blob, Form, FormDef, FormAttachment, FormPartial }) =>
    Promise.all([
      Project.getById(1).then(force),
      FormPartial.fromXml(testData.forms.withAttachments),
      Blob.fromFile(__filename).then((blob) => blob.create())
    ])
      .then(([ project, partial, blob ]) => partial.with({ projectId: project.id }).createNew()
        .then((savedForm) => Promise.all([ 'goodone.csv', 'goodtwo.mp3' ]
          .map((name) => FormAttachment.getByFormDefIdAndName(savedForm.def.id, name)
            .then(force)
            .then((attachment) => attachment.with({ blobId: blob.id }).update()))
        )
          .then(() => FormPartial.fromXml(withAttachmentsNonmatching))
          .then((partial2) => partial2.createVersion(savedForm))
          .then(() => project.getFormByXmlFormId('withAttachments')).then(force)
          .then((finalForm) => FormAttachment.getAllByFormDefId(finalForm.currentDefId)
            .then((attachments) => {
              attachments.length.should.equal(2);
              should.not.exist(attachments[0].blobId);
              should.not.exist(attachments[1].blobId);

              attachments[0].type.should.equal('video'); // n.b. the order swaps because r > g
              attachments[1].name.should.equal('reallygoodone.csv');
            }))))));
});

