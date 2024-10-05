const appRoot = require('app-root-path');
const { testService } = require('../setup');
const testData = require('../../data/xml');

const { exhaust } = require(appRoot + '/lib/worker/worker');

describe('Update / migrate entities-version within form', () => {
  it('should upgrade a 2023.1.0 update form', testService(async (service, container) => {
    const { Forms, Audits } = container;
    const asAlice = await service.login('alice');

    // Publish a form that will set up the dataset with properties
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
});
