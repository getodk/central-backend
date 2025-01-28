const config = require('config');
const { testService } = require('../../setup');
const testData = require('../../../data/xml');

describe('api: /test/:key/projects/:id/forms (testing drafts)', () => {

  ////////////////////////////////////////////////////////////////////////////////
  // DRAFT FORM TESTING
  ////////////////////////////////////////////////////////////////////////////////

  describe('/test/:key/…/:id/draft', () => {
    describe('/formList GET', () => {
      it('should reject if the draft does not exist', testService((service) =>
        service.get('/v1/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/forms/simple/draft/formList')
          .set('X-OpenRosa-Version', '1.0')
          .expect(404)));

      it('should reject if the draft has been published', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
                .expect(200)
                .then(() => service.get(`/v1/test/${token}/projects/1/forms/simple/draft/formList`)
                  .set('X-OpenRosa-Version', '1.0')
                  .expect(404)))))));

      it('should reject after publish with a custom error message', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
                .expect(200)
                .then(() => service.get(`/v1/test/${token}/projects/1/forms/simple/draft/formList`)
                  .set('X-OpenRosa-Version', '1.0')
                  .expect(404)
                  .then(({ text }) => {
                    text.should.match(/You tried to access a draft testing endpoint, but it does not exist anymore or your access is no longer valid\./);
                  })))))));

      it('should reject if the draft has been deleted', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => asAlice.delete('/v1/projects/1/forms/simple/draft')
                .expect(200)
                .then(() => service.get(`/v1/test/${token}/projects/1/forms/simple/draft/formList`)
                  .set('X-OpenRosa-Version', '1.0')
                  .expect(404)))))));

      it('should reject if the key is wrong', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => service.get('/v1/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/forms/simple/draft/formList')
              .set('X-OpenRosa-Version', '1.0')
              .expect(404)
              .then(({ text }) => {
                text.should.match(/You tried to access a draft testing endpoint, but it does not exist anymore or your access is no longer valid\./);
              })))));

      it('should reject on incorrect key with a custom error message', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => service.get('/v1/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/forms/simple/draft/formList')
              .set('X-OpenRosa-Version', '1.0')
              .expect(404)))));

      it('should give an appropriate formList', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => service.get(`/v1/test/${token}/projects/1/forms/simple/draft/formList`)
                .set('X-OpenRosa-Version', '1.0')
                .expect(200)
                .then(({ text }) => {
                  const domain = config.get('default.env.domain');
                  text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
    <xform>
      <formID>simple</formID>
      <name>Simple</name>
      <version></version>
      <hash>md5:5c09c21d4c71f2f13f6aa26227b2d133</hash>
      <downloadUrl>${domain}/v1/test/${token}/projects/1/forms/simple/draft.xml</downloadUrl>
    </xform>
  </xforms>`);
                }))))));

      it('should include a manifest node for forms with attachments', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => service.get(`/v1/test/${token}/projects/1/forms/withAttachments/draft/formList`)
                .set('X-OpenRosa-Version', '1.0')
                .expect(200)
                .then(({ text }) => {
                  const domain = config.get('default.env.domain');
                  text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
    <xform>
      <formID>withAttachments</formID>
      <name>withAttachments</name>
      <version></version>
      <hash>md5:dda89055c8fec222458f702aead30a83</hash>
      <downloadUrl>${domain}/v1/test/${token}/projects/1/forms/withAttachments/draft.xml</downloadUrl>
      <manifestUrl>${domain}/v1/test/${token}/projects/1/forms/withAttachments/draft/manifest</manifestUrl>
    </xform>
  </xforms>`);
                }))))));
    });

    describe('/manifest GET', () => {
      it('should reject if the draft does not exist', testService((service) =>
        service.get('/v1/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/forms/simple/draft/manifest')
          .set('X-OpenRosa-Version', '1.0')
          .expect(404)));

      it('should reject if the draft has been published', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
                .expect(200)
                .then(() => service.get(`/v1/test/${token}/projects/1/forms/withAttachments/draft/manifest`)
                  .set('X-OpenRosa-Version', '1.0')
                  .expect(404)))))));

      it('should reject if the draft has been deleted', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => asAlice.delete('/v1/projects/1/forms/withAttachments/draft')
                .expect(200)
                .then(() => service.get(`/v1/test/${token}/projects/1/forms/withAttachments/draft/manifest`)
                  .set('X-OpenRosa-Version', '1.0')
                  .expect(404)))))));

      it('should reject if the key is wrong', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then(() => service.get('/v1/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/forms/withAttachments/draft/manifest')
                .set('X-OpenRosa-Version', '1.0')
                .expect(404))))));

      it('should return an empty manifest if the draft has no attachments', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => service.get(`/v1/test/${token}/projects/1/forms/simple/draft/manifest`)
                .set('X-OpenRosa-Version', '1.0')
                .expect(200)
                .then(({ text }) => {
                  text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
  </manifest>`);
                }))))));

      it('should return a manifest with present attachments', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => service.get(`/v1/test/${token}/projects/1/forms/withAttachments/draft/manifest`)
                .set('X-OpenRosa-Version', '1.0')
                .expect(200)
                .then(({ text }) => {
                  const domain = config.get('default.env.domain');
                  text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
    <mediaFile>
      <filename>goodone.csv</filename>
      <hash>md5:2241de57bbec8144c8ad387e69b3a3ba</hash>
      <downloadUrl>${domain}/v1/test/${token}/projects/1/forms/withAttachments/draft/attachments/goodone.csv</downloadUrl>
    </mediaFile>
  </manifest>`);
                }))))));
    });

    describe('.xml GET', () => {
      it('should reject if the draft does not exist', testService((service) =>
        service.get('/v1/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/forms/simple/draft.xml')
          .set('X-OpenRosa-Version', '1.0')
          .expect(404)));

      it('should reject if the draft has been published', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => asAlice.post('/v1/projects/1/forms/simple/draft/publish?version=two')
                .expect(200)
                .then(() => service.get(`/v1/test/${token}/projects/1/forms/simple/draft.xml`)
                  .expect(404)))))));

      it('should reject if the draft has been deleted', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200))
            .then(({ body }) => body.draftToken)
            .then((token) => asAlice.delete('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(() => service.get(`/v1/test/${token}/projects/1/forms/simple/draft.xml`)
                .expect(404))))));

      it('should reject if the key is wrong', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => service.get('/v1/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/forms/simple/draft.xml')
              .set('X-OpenRosa-Version', '1.0')
              .expect(404)))));

      it('should give the xml', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => service.get(`/v1/test/${token}/projects/1/forms/simple/draft.xml`)
                .expect(200)
                .then(({ text }) => { text.should.equal(testData.forms.simple); }))))));
    });

    describe('/attachments/:name GET', () => {
      it('should reject if the draft has been published', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
                .expect(200)
                .then(() => service.get(`/v1/test/${token}/projects/1/forms/withAttachments/draft/attachments/goodone.csv`)
                  .expect(404)))))));

      it('should reject if the draft has been deleted', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => asAlice.delete('/v1/projects/1/forms/withAttachments/draft')
                .expect(200)
                .then(() => service.get(`/v1/test/${token}/projects/1/forms/withAttachments/draft/attachments/goodone.csv`)
                  .expect(404)))))));

      it('should reject if the key is wrong', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => service.get('/v1/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .expect(404)))));

      it('should return the attachment', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/draft')
              .expect(200)
              .then(({ body }) => body.draftToken)
              .then((token) => service.get(`/v1/test/${token}/projects/1/forms/withAttachments/draft/attachments/goodone.csv`)
                .expect(200)
                .then(({ text }) => { text.should.equal('test,csv\n1,2'); }))))));
    });
  });
});
