const should = require('should');
const { pick } = require('ramda');
const { testService } = require('../setup');
const testData = require('../data');

describe('form forward versioning', () => {
  const force = (x) => x.get();
  const newXml = testData.forms.simple.replace('id="simple"', 'id="simple" version="two"');

  it('should create a new xform and update the version', testService((_, { Project, Form, XForm }) =>
    Promise.all([
      XForm.parseXml(newXml).then((data) => XForm.fromData(data)),
      Project.getById(1).then(force)
        .then((project) => project.getFormByXmlFormId('simple')).then(force)
    ])
      .then(([ newXform, oldForm ]) => oldForm.createNewVersion(newXform))
      .then(() => Project.getById(1)).then(force)
      .then((project) => project.getFormByXmlFormId('simple')).then(force)
      .then((newForm) => {
        newForm.currentXformId.should.equal(newForm.xform.id);
        /version="two"/.test(newForm.xform.xml).should.equal(true);
        newForm.xform.sha.should.equal('5a31610cb649ccd2482709664e2a6268df66112f');
      })));

  it('should use an extant xform and update the version', testService((_, { Project, Form, XForm }) =>
    Promise.all([
      Project.getById(1).then(force)
        .then((project) => project.getFormByXmlFormId('simple')).then(force),
      Form.fromXml(newXml),
      (new Project({ name: 'Second Project' })).create()
    ])
      .then(([ oldForm, newForm, projectTwo ]) => newForm.with({ projectId: projectTwo.id }).create()
        .then(() => oldForm.createNewVersion(newForm.xform))
        .then(() => Project.getById(1)).then(force)
        .then((project) => project.getFormByXmlFormId('simple')).then(force)
        .then((newForm) => {
          newForm.currentXformId.should.equal(newForm.xform.id);
          /version="two"/.test(newForm.xform.xml).should.equal(true);
          newForm.xform.sha.should.equal('5a31610cb649ccd2482709664e2a6268df66112f');
        }))));

  it('should create a new xform and not update the version', testService((_, { Project, Form, XForm }) =>
    Promise.all([
      XForm.parseXml(newXml).then((data) => XForm.fromData(data)),
      Project.getById(1).then(force)
        .then((project) => project.getFormByXmlFormId('simple')).then(force)
    ])
      .then(([ newXform, oldForm ]) => oldForm.createNewVersion(newXform, false)
        .then(() => Project.getById(1)).then(force)
        .then((project) => project.getFormByXmlFormId('simple')).then(force)
        .then((newForm) => {
          newForm.currentXformId.should.equal(oldForm.xform.id);
          /version="two"/.test(newForm.xform.xml).should.equal(false);
          newForm.xform.sha.should.equal('6f3b4ee76e0ac9a1e2007ef987be40e02c24d75e');
        })))); // TODO: actually assert that the new xform is attached to the form.

  it('should preserve submissions', testService((service, { Project, Blob, Form, XForm, FormAttachment }) =>
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
          XForm.parseXml(newXml).then((data) => XForm.fromData(data)),
          Project.getById(1).then(force)
            .then((project) => project.getFormByXmlFormId('simple')).then(force)
        ])
        .then(([ xform, form ]) => form.createNewVersion(xform))
        .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions')
          .expect(200)
          .then(({ body }) => {
            body.length.should.equal(3);
            body.map((row) => row.instanceId).should.eql([ 'three', 'two', 'one' ]);
          }))))));

  const withAttachmentsMatching = testData.forms.withAttachments
    .replace('id="withAttachments"', 'id="withAttachments" version="two"');
  it('should copy forward matching attachments', testService((_, { Project, Blob, Form, XForm, FormAttachment }) =>
    Promise.all([
      Project.getById(1).then(force),
      Form.fromXml(testData.forms.withAttachments),
      Blob.fromFile(__filename).then((blob) => blob.create())
    ])
      .then(([ project, form, blob ]) => form.with({ projectId: project.id }).create()
        .then((savedForm) => Promise.all([ 'goodone.csv', 'goodtwo.mp3' ]
          .map((name) => FormAttachment.getByXFormIdAndName(savedForm.xform.id, name)
            .then(force)
            .then((attachment) => attachment.with({ blobId: blob.id }).update()))
        )
          .then(() => Form.fromXml(withAttachmentsMatching))
          .then((secondForm) => secondForm.xform)
          .then((xform2) => savedForm.createNewVersion(xform2))
          .then(() => project.getFormByXmlFormId('withAttachments')).then(force)
          .then((finalForm) => FormAttachment.getAllByIds(finalForm.id, finalForm.currentXformId)
            .then((attachments) => {
              savedForm.currentXformId.should.not.equal(finalForm.currentXformId);

              attachments.length.should.equal(2);
              attachments[0].formId.should.equal(finalForm.id);
              attachments[1].formId.should.equal(finalForm.id);
              attachments[0].xformId.should.equal(finalForm.currentXformId);
              attachments[1].xformId.should.equal(finalForm.currentXformId);

              attachments[0].blobId.should.equal(blob.id);
              attachments[1].blobId.should.equal(blob.id);
            }))))));

  const withAttachmentsNonmatching = testData.forms.withAttachments
    .replace('goodone.csv', 'reallygoodone.csv') // name change
    .replace('form="audio"', 'form="video"'); // type change
  it('should not copy forward nonmatching attachments', testService((_, { Project, Blob, Form, XForm, FormAttachment }) =>
    Promise.all([
      Project.getById(1).then(force),
      Form.fromXml(testData.forms.withAttachments),
      Blob.fromFile(__filename).then((blob) => blob.create())
    ])
      .then(([ project, form, blob ]) => form.with({ projectId: project.id }).create()
        .then((savedForm) => Promise.all([ 'goodone.csv', 'goodtwo.mp3' ]
          .map((name) => FormAttachment.getByXFormIdAndName(savedForm.xform.id, name)
            .then(force)
            .then((attachment) => attachment.with({ blobId: blob.id }).update()))
        )
          .then(() => Form.fromXml(withAttachmentsNonmatching))
          .then((secondForm) => secondForm.xform)
          .then((xform2) => savedForm.createNewVersion(xform2))
          .then(() => project.getFormByXmlFormId('withAttachments')).then(force)
          .then((finalForm) => FormAttachment.getAllByIds(finalForm.id, finalForm.currentXformId)
            .then((attachments) => {
              attachments.length.should.equal(2);
              should.not.exist(attachments[0].blobId);
              should.not.exist(attachments[1].blobId);

              attachments[0].type.should.equal('video'); // n.b. the order swaps because r > g
              attachments[1].name.should.equal('reallygoodone.csv');
            }))))));
});

