const should = require('should');
const config = require('config');
const { DateTime } = require('luxon');
const { testService } = require('../../setup');
const testData = require('../../../data/xml');

describe('api: /projects/:id/forms (listing forms)', () => {

  ////////////////////////////////////////////////////////////////////////////////
  // FORM LISTING TESTING
  ////////////////////////////////////////////////////////////////////////////////

  describe('GET', () => {
    it('should reject unless the user can list', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms').expect(403))));

    it('should list forms in order', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms')
          .expect(200)
          .then(({ body }) => {
            body.forEach((form) => form.should.be.a.Form());
            body.map((form) => form.projectId).should.eql([ 1, 1 ]);
            body.map((form) => form.xmlFormId).should.eql([ 'simple', 'withrepeat' ]);
            body.map((form) => form.name).should.eql([ 'Simple', null ]);
            body.map((form) => form.hash).should.eql([ '5c09c21d4c71f2f13f6aa26227b2d133', 'e7e9e6b3f11fca713ff09742f4312029' ]);
            body.map((form) => form.version).should.eql([ '', '1.0' ]);
          }))));

    it('should provide extended metadata if requested', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms')
            .set('X-Extended-Metadata', 'true')
            .expect(200)
            .then(({ body }) => {
              body.forEach((form) => form.should.be.an.ExtendedForm());
              const simple = body.find((form) => form.xmlFormId === 'simple');
              simple.submissions.should.equal(1);
              simple.reviewStates.received.should.equal(1);
              simple.reviewStates.hasIssues.should.equal(0);
              simple.reviewStates.edited.should.equal(0);
              simple.lastSubmission.should.be.a.recentIsoDate();
            })))));
  });

  describe('../forms?deleted=true GET', () => {
    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms?deleted=true').expect(403))));

    it('should list soft-deleted forms', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/withrepeat')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms?deleted=true')
            .expect(200)
            .then(({ body }) => {
              should.exist(body[0].deletedAt);
              body.forEach((form) => form.should.be.a.Form());
              body.map((form) => form.id).should.eql([ 2 ]);
              body.map((form) => form.projectId).should.eql([ 1 ]);
              body.map((form) => form.xmlFormId).should.eql([ 'withrepeat' ]);
              body.map((form) => form.name).should.eql([ null ]);
              body.map((form) => form.hash).should.eql([ 'e7e9e6b3f11fca713ff09742f4312029' ]);
              body.map((form) => form.version).should.eql([ '1.0' ]);
            })))));

    it('should list soft-deleted forms including extended metadata and submissions', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.delete('/v1/projects/1/forms/simple')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms?deleted=true')
              .set('X-Extended-Metadata', 'true')
              .expect(200)
              .then(({ body }) => {
                const simple = body.find((form) => form.xmlFormId === 'simple');
                should.exist(simple.deletedAt);
                simple.submissions.should.equal(1);
                simple.lastSubmission.should.be.a.recentIsoDate();
              }))))));

    it('should not include deletedAt form field on regular forms', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            // eslint-disable-next-line no-prototype-builtins
            body.forEach((form) => form.hasOwnProperty('deletedAt').should.be.false());
          })
          .then(() => asAlice.get('/v1/projects/1/forms')
            .expect(200)
            .then(({ body }) => {
              // eslint-disable-next-line no-prototype-builtins
              body.forEach((form) => form.hasOwnProperty('deletedAt').should.be.false());
            })))));
  });

  describe('../formList GET', () => {
    it('should reject if there is no authentication', testService((service) =>
      service.get('/v1/projects/1/formList')
        .set('X-OpenRosa-Version', '1.0')
        .expect(401)));

    it('should return no results if the user cannot read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/formList')
          .set('X-OpenRosa-Version', '1.0')
          .expect(200)
          .then(({ text }) => {
            text.should.eql(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
  </xforms>`);
          }))));

    it('should return form details as xml', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/formList')
          .set('X-OpenRosa-Version', '1.0')
          .expect(200)
          .then(({ text, headers }) => {
            // Collect is particular about this:
            headers['content-type'].should.equal('text/xml; charset=utf-8');

            const domain = config.get('default.env.domain');
            text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
    <xform>
      <formID>simple</formID>
      <name>Simple</name>
      <version></version>
      <hash>md5:5c09c21d4c71f2f13f6aa26227b2d133</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/simple.xml</downloadUrl>
    </xform>
    <xform>
      <formID>withrepeat</formID>
      <name>withrepeat</name>
      <version>1.0</version>
      <hash>md5:e7e9e6b3f11fca713ff09742f4312029</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withrepeat.xml</downloadUrl>
    </xform>
  </xforms>`);
          }))));

    it('should return only return matching form given formID=', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/formList?formID=withrepeat')
          .set('X-OpenRosa-Version', '1.0')
          .expect(200)
          .then(({ text, headers }) => {
            // Collect is particular about this:
            headers['content-type'].should.equal('text/xml; charset=utf-8');

            const domain = config.get('default.env.domain');
            text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
    <xform>
      <formID>withrepeat</formID>
      <name>withrepeat</name>
      <version>1.0</version>
      <hash>md5:e7e9e6b3f11fca713ff09742f4312029</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withrepeat.xml</downloadUrl>
    </xform>
  </xforms>`);
          }))));

    it('should return nothing given a nonmatching formID=', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/formList?formID=xyz')
          .set('X-OpenRosa-Version', '1.0')
          .expect(200)
          .then(({ text, headers }) => {
            // Collect is particular about this:
            headers['content-type'].should.equal('text/xml; charset=utf-8');

            text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
  </xforms>`);
          }))));

    it('should return auth-filtered results for app users', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users')
          .send({ displayName: 'test' })
          .expect(200)
          .then(({ body }) => body)
          .then((fk) => asAlice.post(`/v1/projects/1/forms/withrepeat/assignments/app-user/${fk.id}`)
            .expect(200)
            .then(() => service.get(`/v1/key/${fk.token}/projects/1/formList`)
              .set('X-OpenRosa-Version', '1.0')
              .expect(200)
              .then(({ text, headers }) => {
                // Collect is particular about this:
                headers['content-type'].should.equal('text/xml; charset=utf-8');

                const domain = config.get('default.env.domain');
                text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
    <xform>
      <formID>withrepeat</formID>
      <name>withrepeat</name>
      <version>1.0</version>
      <hash>md5:e7e9e6b3f11fca713ff09742f4312029</hash>
      <downloadUrl>${domain}/v1/key/${fk.token}/projects/1/forms/withrepeat.xml</downloadUrl>
    </xform>
  </xforms>`);
              }))))));

    it('should prefix returned routes for app users', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/app-users')
          .send({ displayName: 'test' })
          .expect(200)
          .then(({ body }) => body)
          .then((fk) => asAlice.post(`/v1/projects/1/forms/withrepeat/assignments/app-user/${fk.id}`)
            .expect(200)
            .then(() => service.get(`/v1/projects/1/formList?st=${fk.token}`)
              .set('X-OpenRosa-Version', '1.0')
              .expect(200)
              .then(({ text, headers }) => {
                // Collect is particular about this:
                headers['content-type'].should.equal('text/xml; charset=utf-8');

                const domain = config.get('default.env.domain');
                text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
    <xform>
      <formID>withrepeat</formID>
      <name>withrepeat</name>
      <version>1.0</version>
      <hash>md5:e7e9e6b3f11fca713ff09742f4312029</hash>
      <downloadUrl>${domain}/v1/key/${fk.token}/projects/1/forms/withrepeat.xml</downloadUrl>
    </xform>
  </xforms>`);
              }))))));

    it('should not include closing/closed forms', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.patch('/v1/projects/1/forms/withrepeat')
          .send({ state: 'closing' })
          .expect(200)
          .then(() => asAlice.patch('/v1/projects/1/forms/simple')
            .send({ state: 'closing' })
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/formList')
              .set('X-OpenRosa-Version', '1.0')
              .expect(200)
              .then(({ text }) => {
                text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
  </xforms>`);
              }))))));

    it('should not include deleted forms', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.delete('/v1/projects/1/forms/withrepeat')
          .expect(200)
          .then(() => asAlice.delete('/v1/projects/1/forms/simple')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/formList')
              .set('X-OpenRosa-Version', '1.0')
              .set('Date', DateTime.local().toHTTP())
              .expect(200)
              .then(({ text }) => {
                text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
  </xforms>`);
              }))))));

    it('should not include forms without published versions', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/formList')
            .set('X-OpenRosa-Version', '1.0')
            .expect(200)
            .then(({ text }) => {
              text.includes('simple2').should.equal(false);
            })))));

    it('should escape illegal characters in url', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.withAttachments.replace('withAttachments', 'with attachments'))
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/formList')
            .set('X-OpenRosa-Version', '1.0')
            .expect(200)
            .then(({ text }) => {
              const domain = config.get('default.env.domain');
              text.should.containEql(`<downloadUrl>${domain}/v1/projects/1/forms/with%20attachments.xml</downloadUrl>`);
              text.should.containEql(`<manifestUrl>${domain}/v1/projects/1/forms/with%20attachments/manifest</manifestUrl>`);
            })))));

    it('should include a manifest node for forms with attachments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.withAttachments)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/formList')
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
      <downloadUrl>${domain}/v1/projects/1/forms/simple.xml</downloadUrl>
    </xform>
    <xform>
      <formID>withAttachments</formID>
      <name>withAttachments</name>
      <version></version>
      <hash>md5:7eb21b5b123b0badcf2b8f50bcf1cbd0</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withAttachments.xml</downloadUrl>
      <manifestUrl>${domain}/v1/projects/1/forms/withAttachments/manifest</manifestUrl>
    </xform>
    <xform>
      <formID>withrepeat</formID>
      <name>withrepeat</name>
      <version>1.0</version>
      <hash>md5:e7e9e6b3f11fca713ff09742f4312029</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withrepeat.xml</downloadUrl>
    </xform>
  </xforms>`);
            })))));

    it('should list the correct form given duplicates across projects', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects')
          .send({ name: 'Project Two' })
          .expect(200)
          .then(({ body }) => body.id)
          .then((projectTwoId) => asAlice.post(`/v1/projects/${projectTwoId}/forms?publish=true`)
            .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="two"'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => Promise.all([
              asAlice.get('/v1/projects/1/formList')
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
      <downloadUrl>${domain}/v1/projects/1/forms/simple.xml</downloadUrl>
    </xform>
    <xform>
      <formID>withrepeat</formID>
      <name>withrepeat</name>
      <version>1.0</version>
      <hash>md5:e7e9e6b3f11fca713ff09742f4312029</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withrepeat.xml</downloadUrl>
    </xform>
  </xforms>`);
                }),
              asAlice.get(`/v1/projects/${projectTwoId}/formList`)
                .set('X-OpenRosa-Version', '1.0')
                .expect(200)
                .then(({ text }) => {
                  const domain = config.get('default.env.domain');
                  text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
    <xform>
      <formID>simple</formID>
      <name>Simple</name>
      <version>two</version>
      <hash>md5:8240cdc372a373170ee87c1eab2c60bc</hash>
      <downloadUrl>${domain}/v1/projects/${projectTwoId}/forms/simple.xml</downloadUrl>
    </xform>
  </xforms>`);
                })
            ]))))));

    it('should encode html entities in the response', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simple.replace('<h:title>Simple</h:title>', '<h:title>Crate &amp; Barrel</h:title>').replace('id="simple"', 'id="htmlEntities"'))
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/formList')
            .set('X-OpenRosa-Version', '1.0')
            .expect(200)
            .then(({ text }) => {
              text.should.containEql('<name>Crate &amp; Barrel</name>');
              text.should.not.containEql('<name>Crate &amp;amp; Barrel</name>');
            })))));
  });
});
