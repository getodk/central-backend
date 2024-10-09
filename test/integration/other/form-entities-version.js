const { readFileSync } = require('fs');
const appRoot = require('app-root-path');
const { testService } = require('../setup');
const testData = require('../../data/xml');

const { exhaust } = require(appRoot + '/lib/worker/worker');

describe('Update / migrate entities-version within form', () => {
  describe('upgrading a 2023.1.0 update form', () => {
    it('should upgrade a form with only a published version', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Publish a form
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.updateEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity').then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      await asAlice.get('/v1/projects/1/forms/updateEntity/versions')
        .then(({ body }) => {
          body.length.should.equal(2);
          body[0].version.should.equal('1.0_upgrade');
          body[1].version.should.equal('1.0');
        });

      await asAlice.get('/v1/projects/1/forms/updateEntity.xml')
        .then(({ text }) => {
          text.should.equal(`<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
  <h:head>
    <model entities:entities-version="2024.1.0">
      <instance>
        <data id="updateEntity" orx:version="1.0_upgrade">
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
</h:html>`);
        });
    }));

    it('should upgrade a form with only a draft version', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Upload a form but dont publish, leaving it as a draft
      await asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.updateEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);


      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity').then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      // The version on the draft does change even though it is updated in place
      await asAlice.get('/v1/projects/1/forms/updateEntity/draft')
        .then(({ body }) => {
          body.version.should.equal('1.0_upgrade');
        });

      await asAlice.get('/v1/projects/1/forms/updateEntity/versions')
        .then(({ body }) => {
          body.length.should.equal(0);
        });

      // The XML is updated
      await asAlice.get('/v1/projects/1/forms/updateEntity/draft.xml')
        .then(({ text }) => {
          text.should.equal(`<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
  <h:head>
    <model entities:entities-version="2024.1.0">
      <instance>
        <data id="updateEntity" orx:version="1.0_upgrade">
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
</h:html>`);
        });
    }));

    it('should upgrade a form with a draft version and a published version', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Upload a form and publish it
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.updateEntity)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Convert the published form to a draft
      await asAlice.post('/v1/projects/1/forms/updateEntity/draft');

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity').then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      // The version on the draft does change even though it is updated in place
      await asAlice.get('/v1/projects/1/forms/updateEntity/draft')
        .then(({ body }) => {
          body.version.should.equal('1.0_upgrade');
        });

      await asAlice.get('/v1/projects/1/forms/updateEntity/versions')
        .then(({ body }) => {
          body.length.should.equal(2);
          body[0].version.should.equal('1.0_upgrade');
          body[1].version.should.equal('1.0');
        });

      const updatedXml = `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
  <h:head>
    <model entities:entities-version="2024.1.0">
      <instance>
        <data id="updateEntity" orx:version="1.0_upgrade">
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

      // The published form XML is updated
      await asAlice.get('/v1/projects/1/forms/updateEntity.xml')
        .then(({ text }) => text.should.equal(updatedXml));

      // The draft XML is updated
      await asAlice.get('/v1/projects/1/forms/updateEntity/draft.xml')
        .then(({ text }) => text.should.equal(updatedXml));
    }));

    // only latest version of a form gets updated

    it('should carry forward the xlsx file of a published form', testService(async (service, container) => {
      const { Forms, Audits } = container;
      const asAlice = await service.login('alice');

      // Upload updateEntities form with xlsx
      global.xlsformForm = 'updateEntity';
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
        .set('Content-Type', 'application/vnd.ms-excel')
        .set('X-XlsForm-FormId-Fallback', 'testformid')
        .expect(200);

      // Before migrating, xls version of form can be accessed
      await asAlice.get('/v1/projects/1/forms/updateEntity.xls')
        .then(({ headers }) => {
          headers.etag.should.equal('"30fdb0e9115ea7ca6702573f521814d1"');
        });

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity').then(o => o.get());
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
      await asAlice.post('/v1/projects/1/forms')
        .send(readFileSync(appRoot + '/test/data/simple.xlsx'))
        .set('Content-Type', 'application/vnd.ms-excel')
        .set('X-XlsForm-FormId-Fallback', 'testformid')
        .expect(200);

      // Before migrating, xls version of form can be accessed
      await asAlice.get('/v1/projects/1/forms/updateEntity/draft.xls')
        .then(({ headers }) => {
          headers.etag.should.equal('"30fdb0e9115ea7ca6702573f521814d1"');
        });

      const { acteeId } = await Forms.getByProjectAndXmlFormId(1, 'updateEntity').then(o => o.get());
      await Audits.log(null, 'upgrade.process.form.entities_version', { acteeId });

      // Run form upgrade
      await exhaust(container);

      await asAlice.get('/v1/projects/1/forms/updateEntity/draft.xls')
        .expect(200)
        .then(({ headers }) => {
          headers.etag.should.equal('"30fdb0e9115ea7ca6702573f521814d1"');
        });
    }));
  });
});
