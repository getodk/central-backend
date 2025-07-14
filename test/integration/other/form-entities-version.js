const { readFileSync } = require('fs');
const should = require('should');
const config = require('config');
const appRoot = require('app-root-path');
const { testService } = require('../setup');
const testData = require('../../data/xml');

const { exhaust } = require(appRoot + '/lib/worker/worker');
const { Form } = require(appRoot + '/lib/model/frames');

const upgradedUpdateEntity = `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
  <h:head>
    <model entities:entities-version="2024.1.0">
      <instance>
        <data id="updateEntity" orx:version="1.0[upgrade]">
          <name/>
          <age/>
          <hometown/>
          <meta>
            <entity dataset="people" id="" update="" baseVersion="" trunkVersion="" branchId="">
              <label/>
            </entity>
          </meta>
        </data>
      </instance>
      <bind nodeset="/data/name" type="string" entities:saveto="first_name"/>
      <bind nodeset="/data/age" type="int" entities:saveto="age"/>
    </model>
  </h:head>
</h:html>`;

const upgradedSimpleEntity = `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
  <h:head>
    <model entities:entities-version="2024.1.0">
      <instance>
        <data id="simpleEntity" orx:version="1.0[upgrade]">
          <name/>
          <age/>
          <hometown/>
          <meta>
            <entity dataset="people" id="" create="">
              <label/>
            </entity>
          </meta>
        </data>
      </instance>
      <bind nodeset="/data/name" type="string" entities:saveto="first_name"/>
      <bind nodeset="/data/age" type="int" entities:saveto="age"/>
      <bind nodeset="/data/hometown" type="string"/>
    </model>
  </h:head>
</h:html>`;

describe('Update / migrate entities-version within form', () => {
  describe('upgrading a 2023.1.0 update form', () => {
    it('should upgrade a form with only a published version', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Publish a form
      await asAlice.post('/v1/projects/1/forms?publish=true&ignoreWarnings=true')
        .send(testData.forms.updateEntity2023)
        .set('Content-Type', 'application/xml')
        .expect(200);

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      await asAlice.get('/v1/projects/1/forms/updateEntity/versions')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(2);
          body[0].version.should.equal('1.0[upgrade]');
          body[1].version.should.equal('1.0');
        });

      await asAlice.get('/v1/projects/1/forms/updateEntity.xml')
        .expect(200)
        .then(({ text }) => text.should.equal(upgradedUpdateEntity));
    }));

    it('should upgrade a form with only a draft version', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Upload a form but dont publish, leaving it as a draft
      await asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
        .send(testData.forms.updateEntity2023)
        .set('Content-Type', 'application/xml')
        .expect(200);


      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      // The version on the draft does change even though it is updated in place
      await asAlice.get('/v1/projects/1/forms/updateEntity/draft')
        .expect(200)
        .then(({ body }) => {
          body.version.should.equal('1.0[upgrade]');
        });

      await asAlice.get('/v1/projects/1/forms/updateEntity/versions')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(0);
        });

      // The XML is updated
      await asAlice.get('/v1/projects/1/forms/updateEntity/draft.xml')
        .expect(200)
        .then(({ text }) => text.should.equal(upgradedUpdateEntity));
    }));

    it('should upgrade a form with a draft version and a published version', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Upload a form and publish it
      await asAlice.post('/v1/projects/1/forms?publish=true&ignoreWarnings=true')
        .send(testData.forms.updateEntity2023)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Convert the published form to a draft
      await asAlice.post('/v1/projects/1/forms/updateEntity/draft')
        .expect(200);

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      // The version on the draft does change even though it is updated in place
      await asAlice.get('/v1/projects/1/forms/updateEntity/draft')
        .expect(200)
        .then(({ body }) => {
          body.version.should.equal('1.0[upgrade]');
        });

      await asAlice.get('/v1/projects/1/forms/updateEntity/versions')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(2);
          body[0].version.should.equal('1.0[upgrade]');
          body[1].version.should.equal('1.0');
        });

      // The published form XML is updated
      await asAlice.get('/v1/projects/1/forms/updateEntity.xml')
        .expect(200)
        .then(({ text }) => text.should.equal(upgradedUpdateEntity));

      // The draft XML is updated
      await asAlice.get('/v1/projects/1/forms/updateEntity/draft.xml')
        .expect(200)
        .then(({ text }) => text.should.equal(upgradedUpdateEntity));
    }));

    it('should only upgrade the latest version of a form', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Publish a form
      await asAlice.post('/v1/projects/1/forms?publish=true&ignoreWarnings=true')
        .send(testData.forms.updateEntity2023)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/updateEntity/draft')
        .send(testData.forms.updateEntity2023.replace('orx:version="1.0"', ' orx:version="2.0"'))
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/updateEntity/draft/publish')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/updateEntity/draft')
        .send(testData.forms.updateEntity2023.replace('orx:version="1.0"', ' orx:version="3.0"'))
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/updateEntity/draft/publish')
        .expect(200);

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      await asAlice.get('/v1/projects/1/forms/updateEntity/versions')
        .expect(200)
        .then(({ body }) => {
          body.map(f => f.version).should.eql([ '3.0[upgrade]', '3.0', '2.0', '1.0' ]);
        });
    }));

    it('should carry forward the xlsx file of a published form', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Upload updateEntities form with xlsx
      global.xlsformForm = 'updateEntity';
      await asAlice.post('/v1/projects/1/forms?publish=true&ignoreWarnings=true')
        .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
        .set('Content-Type', 'application/vnd.ms-excel')
        .set('X-XlsForm-FormId-Fallback', 'testformid')
        .expect(200);

      // Before migrating, xls version of form can be accessed
      await asAlice.get('/v1/projects/1/forms/updateEntity.xls')
        .expect(200)
        .then(({ headers }) => {
          headers.etag.should.equal('"30fdb0e9115ea7ca6702573f521814d1"');
        });

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      await asAlice.get('/v1/projects/1/forms/updateEntity.xls')
        .expect(200)
        .then(({ headers }) => {
          headers.etag.should.equal('"30fdb0e9115ea7ca6702573f521814d1"');
        });
    }));

    it('should carry forward the xlsx file of a draft form', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Upload updateEntities form with xlsx
      global.xlsformForm = 'updateEntity';
      await asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
        .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
        .set('Content-Type', 'application/vnd.ms-excel')
        .set('X-XlsForm-FormId-Fallback', 'testformid')
        .expect(200);

      // Before migrating, xls version of form can be accessed
      await asAlice.get('/v1/projects/1/forms/updateEntity/draft.xls')
        .expect(200)
        .then(({ headers }) => {
          headers.etag.should.equal('"30fdb0e9115ea7ca6702573f521814d1"');
        });

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      await asAlice.get('/v1/projects/1/forms/updateEntity/draft.xls')
        .expect(200)
        .then(({ headers }) => {
          headers.etag.should.equal('"30fdb0e9115ea7ca6702573f521814d1"');
        });
    }));

    it('should carry forward the attachments of a form', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      const withAttachmentsEntities = testData.forms.withAttachments
        .replace('<model>', '<model entities:entities-version="2023.1.0">')
        .replace('</meta>', '<entity dataset="people" id="" update="" baseVersion=""><label/></entity></meta>');

      // Upload a form
      await asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
        .send(withAttachmentsEntities)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Upload an attachment
      await asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
        .send('test,csv\n1,2')
        .set('Content-Type', 'text/csv')
        .expect(200);

      // Publish the draft
      await asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
        .expect(200);

      // Create a draft
      await asAlice.post('/v1/projects/1/forms/withAttachments/draft')
        .expect(200);

      await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments')
        .expect(200)
        .then(({ body }) => {
          // eslint-disable-next-line no-param-reassign
          delete body[0].updatedAt;
          body.should.eql([
            { name: 'goodone.csv', type: 'file', exists: true, blobExists: true, datasetExists: false, hash: '2241de57bbec8144c8ad387e69b3a3ba' },
            { name: 'goodtwo.mp3', type: 'audio', exists: false, blobExists: false, datasetExists: false, hash: null }
          ]);
        });

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'withAttachments', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      // Check form xml (published)
      await asAlice.get('/v1/projects/1/forms/withAttachments.xml')
        .expect(200)
        .then(({ text }) => {
          text.includes('entities:entities-version="2024.1.0"').should.equal(true);
          text.includes('version="[upgrade]"').should.equal(true);
          text.includes('trunkVersion="" branchId=""').should.equal(true);
        });

      // Check form xml (draft)
      await asAlice.get('/v1/projects/1/forms/withAttachments/draft.xml')
        .expect(200)
        .then(({ text }) => {
          text.includes('entities:entities-version="2024.1.0"').should.equal(true);
          text.includes('version="[upgrade]"').should.equal(true);
          text.includes('trunkVersion="" branchId=""').should.equal(true);
        });

      // Check attachments
      await asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
        .expect(200)
        .then(({ body }) => {
          // eslint-disable-next-line no-param-reassign
          delete body[0].updatedAt;
          body.should.eql([
            { name: 'goodone.csv', type: 'file', exists: true, blobExists: true, datasetExists: false, hash: '2241de57bbec8144c8ad387e69b3a3ba' },
            { name: 'goodtwo.mp3', type: 'audio', exists: false, blobExists: false, datasetExists: false, hash: null }
          ]);
        });

      await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments')
        .expect(200)
        .then(({ body }) => {
          // eslint-disable-next-line no-param-reassign
          delete body[0].updatedAt;
          body.should.eql([
            { name: 'goodone.csv', type: 'file', exists: true, blobExists: true, datasetExists: false, hash: '2241de57bbec8144c8ad387e69b3a3ba' },
            { name: 'goodtwo.mp3', type: 'audio', exists: false, blobExists: false, datasetExists: false, hash: null }
          ]);
        });
    }));

    it('should update the formList once the form changes', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');
      const domain = config.get('default.env.domain');

      // Publish a form
      await asAlice.post('/v1/projects/1/forms?publish=true&ignoreWarnings=true')
        .send(testData.forms.updateEntity2023)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Create a draft as well
      await asAlice.post('/v1/projects/1/forms/updateEntity/draft')
        .expect(200);

      const token = await asAlice.get('/v1/projects/1/forms/updateEntity/draft')
        .expect(200)
        .then(({ body }) => body.draftToken);

      await asAlice.get('/v1/projects/1/formList')
        .set('X-OpenRosa-Version', '1.0')
        .expect(200)
        .then(({ text }) => text.should.containEql(`<xform>
      <formID>updateEntity</formID>
      <name>updateEntity</name>
      <version>1.0</version>
      <hash>md5:e4902c380ef428aa3d35e4ed17ea6c04</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/updateEntity.xml</downloadUrl>
    </xform>`));

      await asAlice.get(`/v1/test/${token}/projects/1/forms/updateEntity/draft/formList`)
        .set('X-OpenRosa-Version', '1.0')
        .expect(200)
        .then(({ text }) => text.should.containEql(`<xform>
      <formID>updateEntity</formID>
      <name>updateEntity</name>
      <version>1.0</version>
      <hash>md5:e4902c380ef428aa3d35e4ed17ea6c04</hash>
      <downloadUrl>${domain}/v1/test/${token}/projects/1/forms/updateEntity/draft.xml</downloadUrl>
    </xform>`));

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      await asAlice.get('/v1/projects/1/formList')
        .set('X-OpenRosa-Version', '1.0')
        .expect(200)
        .then(({ text }) => text.should.containEql(`<xform>
      <formID>updateEntity</formID>
      <name>updateEntity</name>
      <version>1.0[upgrade]</version>
      <hash>md5:77292dd9e1ad532bb5a4f7128e0a9596</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/updateEntity.xml</downloadUrl>
    </xform>`));

      await asAlice.get(`/v1/test/${token}/projects/1/forms/updateEntity/draft/formList`)
        .set('X-OpenRosa-Version', '1.0')
        .expect(200)
        .then(({ text }) => text.should.containEql(`<xform>
      <formID>updateEntity</formID>
      <name>updateEntity</name>
      <version>1.0[upgrade]</version>
      <hash>md5:77292dd9e1ad532bb5a4f7128e0a9596</hash>
      <downloadUrl>${domain}/v1/test/${token}/projects/1/forms/updateEntity/draft.xml</downloadUrl>
    </xform>`));
    }));

    it('should update the updatedAt timestamps on the form when updating a draft form', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Upload a form and publish it
      await asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
        .send(testData.forms.updateEntity2023)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // check updatedAt on the draft form
      await asAlice.get('/v1/projects/1/forms/updateEntity')
        .expect(200)
        .then(({ body }) => {
          should(body.updatedAt).be.null();
        });

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      // REVIEW maybe this shouldn't change - maybe the base form endpoint should always provide basic info
      await asAlice.get('/v1/projects/1/forms/updateEntity/draft')
        .expect(200)
        .then(({ body }) => {
          body.updatedAt.should.be.a.recentIsoDate();
        });
    }));

    it('should update the updatedAt timestamps on the form when updating a published form', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Upload a form and publish it
      await asAlice.post('/v1/projects/1/forms?publish=true&ignoreWarnings=true')
        .send(testData.forms.updateEntity2023)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // check updatedAt on the draft form
      await asAlice.get('/v1/projects/1/forms/updateEntity')
        .expect(200)
        .then(({ body }) => {
          should(body.updatedAt).be.null();
        });

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      await asAlice.get('/v1/projects/1/forms/updateEntity')
        .expect(200)
        .then(({ body }) => {
          body.updatedAt.should.be.a.recentIsoDate();
        });
    }));

    it('should set publishedBy to null on the form when updating a published form', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Upload a form and publish it
      await asAlice.post('/v1/projects/1/forms?publish=true&ignoreWarnings=true')
        .send(testData.forms.updateEntity2023)
        .set('Content-Type', 'application/xml')
        .expect(200);

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      // publishedBy is null on the latest version of the form
      await asAlice.get('/v1/projects/1/forms/updateEntity/versions')
        .set('X-Extended-Metadata', 'true')
        .expect(200)
        .then(({ body }) => {
          should(body[0].publishedBy).be.null();
          body[1].publishedBy.should.be.an.Actor();
        });
    }));
  });

  describe('upgrading a 2022.1.0 create form', () => {
    it('should upgrade a form with a draft version and a published version', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Upload a form and publish it
      await asAlice.post('/v1/projects/1/forms?publish=true&ignoreWarnings=true')
        .send(testData.forms.simpleEntity2022)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Convert the published form to a draft
      await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
        .expect(200);

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'simpleEntity', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      // The version on the draft does change even though it is updated in place
      await asAlice.get('/v1/projects/1/forms/simpleEntity/draft')
        .expect(200)
        .then(({ body }) => {
          body.version.should.equal('1.0[upgrade]');
        });

      await asAlice.get('/v1/projects/1/forms/simpleEntity/versions')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(2);
          body[0].version.should.equal('1.0[upgrade]');
          body[1].version.should.equal('1.0');
        });

      // The published form XML is updated
      await asAlice.get('/v1/projects/1/forms/simpleEntity.xml')
        .expect(200)
        .then(({ text }) => text.should.equal(upgradedSimpleEntity));

      // The draft XML is updated
      await asAlice.get('/v1/projects/1/forms/simpleEntity/draft.xml')
        .expect(200)
        .then(({ text }) => text.should.equal(upgradedSimpleEntity));
    }));
  });

  describe('audit logging and errors', () => {
    it('should log events about the upgrade for a published form', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Upload a form and publish it
      await asAlice.post('/v1/projects/1/forms?publish=true&ignoreWarnings=true')
        .send(testData.forms.updateEntity2023)
        .set('Content-Type', 'application/xml')
        .expect(200);

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      await asAlice.get('/v1/audits')
        .expect(200)
        .then(({ body }) => {
          const actions = body.map(a => a.action);
          actions.should.eql([
            'form.update.publish',
            'upgrade.process.form.entities_version',
            'form.update.publish',
            'dataset.create',
            'form.create',
            'user.session.create'
          ]);
        });
    }));

    it('should log events about the upgrade for a draft form', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Upload a form and publish it
      await asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
        .send(testData.forms.updateEntity2023)
        .set('Content-Type', 'application/xml')
        .expect(200);

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      await asAlice.get('/v1/audits')
        .expect(200)
        .then(({ body }) => {
          const actions = body.map(a => a.action);
          actions.should.eql([
            'form.update.draft.replace',
            'upgrade.process.form.entities_version',
            'form.create',
            'user.session.create'
          ]);

          body[0].details.should.eql({ upgrade: 'Updated entities-version in form draft to 2024.1' });
        });
    }));

    it('should log events about the upgrade for a published and draft form', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Upload a form and publish it
      await asAlice.post('/v1/projects/1/forms?publish=true&ignoreWarnings=true')
        .send(testData.forms.updateEntity2023)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/updateEntity/draft')
        .expect(200);

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      await asAlice.get('/v1/audits')
        .expect(200)
        .then(({ body }) => {
          const actions = body.map(a => a.action);
          actions.should.eql([
            'form.update.draft.replace',
            'form.update.publish',
            'upgrade.process.form.entities_version',
            'form.update.draft.set',
            'form.update.publish',
            'dataset.create',
            'form.create',
            'user.session.create'
          ]);

          body[0].details.should.eql({ upgrade: 'Updated entities-version in form draft to 2024.1' });
        });
    }));

    it('should update the audit log event for a successful upgrade', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Publish a form
      await asAlice.post('/v1/projects/1/forms?publish=true&ignoreWarnings=true')
        .send(testData.forms.updateEntity2023)
        .set('Content-Type', 'application/xml')
        .expect(200);

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      const audit = await Audits.getLatestByAction('upgrade.process.form.entities_version').then((o) => o.get());
      audit.processed.should.be.a.recentDate();
      audit.failures.should.equal(0);
    }));

    it('should not update form if there is a problem, but should process audit event', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Publish an invalid XML form
      const invalidForm = testData.forms.updateEntity2023.replace('<entity', '<something');
      await asAlice.post('/v1/projects/1/forms?publish=true&ignoreWarnings=true')
        .send(invalidForm)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/updateEntity/draft')
        .expect(200);

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      // The published form XML is the same
      await asAlice.get('/v1/projects/1/forms/updateEntity.xml')
        .expect(200)
        .then(({ text }) => text.should.equal(invalidForm));

      // The draft XML is the same
      await asAlice.get('/v1/projects/1/forms/updateEntity/draft.xml')
        .expect(200)
        .then(({ text }) => text.should.equal(invalidForm));

      // Check form versions
      await asAlice.get('/v1/projects/1/forms/updateEntity/versions')
        .expect(200)
        .then(({ body }) => {
          body.map(f => f.version).should.eql([ '1.0' ]);
        });

      // Check audit log
      const audit = await Audits.getLatestByAction('upgrade.process.form.entities_version').then((o) => o.get());
      audit.processed.should.be.a.recentDate();
      audit.failures.should.equal(0);
    }));

    it('should not update form if the entities version is not the target one (e.g. 2024.1)', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Publish an XML form of the right version
      await asAlice.post('/v1/projects/1/forms?publish=true&ignoreWarnings=true')
        .send(testData.forms.offlineEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'offlineEntity', false, Form.NoDefRequired).then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      // The published form XML is the same
      await asAlice.get('/v1/projects/1/forms/offlineEntity.xml')
        .expect(200)
        .then(({ text }) => text.should.equal(testData.forms.offlineEntity));
    }));
  });
});
