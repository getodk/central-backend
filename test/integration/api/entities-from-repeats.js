const { sql } = require('slonik');
const { testService } = require('../setup');
const { exhaust } = require('../../../lib/worker/worker');

// TODO: refine a bit before putting in shared test data xml
const treesRepeat = `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:entities="http://www.opendatakit.org/xforms/entities" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:orx="http://openrosa.org/xforms" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
 <h:head>
   <h:title>Register many trees</h:title>
   <model odk:xforms-version="1.0.0" entities:entities-version="2025.1.0">
     <instance>
       <data id="trees_registration" version="2025040701">
        <plot>
          <location />
        </plot>
        <tree>
          <location />
          <species />
          <meta>
            <entity dataset="trees" create="" id="">
              <label />
            </entity>
          </meta>
         </tree>
        
         <meta>
           <instanceID/>
           <entity dataset="plots" id="" create="">
              <label/>
            </entity>
         </meta>
       </data>
     </instance>
     <bind nodeset="/data/plot/location" type="geopoint" entities:saveto="geometry" />

     <bind nodeset="/data/tree/location" type="geopoint" entities:saveto="geometry" />
     <bind nodeset="/data/tree/species" type="string" entities:saveto="species" />


     <bind nodeset="/data/tree/meta/entity/@id" type="string"/>
     <setvalue event="odk-instance-first-load odk-new-repeat" ref="/data/tree/meta/entity/@id" value="uuid()"/>
    
     <bind nodeset="/data/tree/meta/entity/label" calculate="../../../species"  type="string"/>


     <bind jr:preload="uid" nodeset="/data/meta/instanceID" readonly="true()" type="string"/>
   </model>
 </h:head>
 <body>
   <group ref="/data/tree">
     <label>Tree</label>
     <repeat nodeset="/data/tree">
       <input ref="/data/tree/location">
           <label>Tree location</label>
       </input>
       <input ref="/data/tree/species">
           <label>Tree species</label>
       </input>
     </repeat>
   </group>
 </body>
</h:html>`;

const treesdata = `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="trees_registration" version="2025040701">
      <meta>
        <instanceID>one</instanceID>
        <entities:entity dataset="plots" id="uuid:12345678-1234-4123-8234-123456789aaa" create="1">
          <entities:label>Plot 1</entities:label>
        </entities:entity>
        <orx:instanceName>one</orx:instanceName>
      </meta>
      <plot><location>gps123</location></plot>
      <tree>
        <location>gps111</location>
        <species>pine</species>
        <meta>
          <entity dataset="trees" create="1" id="a5c794c5-cca2-4f01-b8c3-ad146986f9cc">
            <label>Tree 1</label>
          </entity>
        </meta>
      </tree>
      <tree>
        <location>gps222</location>
        <species>birch</species>
        <meta>
          <entity dataset="trees" create="1" id="bfb88559-9a98-4ed0-b7e0-d8d8d9d9e3cf">
            <label>Tree 2</label>
          </entity>
        </meta>
      </tree>
    </data>
`;

describe('Entities from Repeats', () => {
  describe('form parsing', () => {
    it('should identify entity block nested at a different level within a repeat', testService(async (service, { all }) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(treesRepeat)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.get('/v1/projects/1/datasets/trees')
        .then(({ body }) => {
          const { createdAt, linkedForms, properties, sourceForms, lastUpdate, ...ds } = body;

          ds.should.be.eql({
            name: 'trees',
            projectId: 1,
            approvalRequired: false,
            ownerOnly: false
          });

          createdAt.should.not.be.null();

          lastUpdate.should.be.isoDate();

          linkedForms.should.be.eql([]);

          sourceForms.should.be.eql([
            { name: 'Register many trees', xmlFormId: 'trees_registration' },
          ]);

          properties.map(({ publishedAt, ...p }) => {
            publishedAt.should.be.isoDate();
            return p;
          }).should.be.eql([
            { name: 'geometry', odataName: 'geometry', forms: [ { name: 'Register many trees', xmlFormId: 'trees_registration' } ] },
            { name: 'species', odataName: 'species', forms: [ { name: 'Register many trees', xmlFormId: 'trees_registration' } ] },
          ]);

        });

      await asAlice.get('/v1/projects/1/datasets/plots')
        .then(({ body }) => {
          const { createdAt, linkedForms, properties, sourceForms, lastUpdate, ...ds } = body;

          ds.should.be.eql({
            name: 'plots',
            projectId: 1,
            approvalRequired: false,
            ownerOnly: false
          });

          createdAt.should.not.be.null();

          lastUpdate.should.be.isoDate();

          linkedForms.should.be.eql([]);

          sourceForms.should.be.eql([
            { name: 'Register many trees', xmlFormId: 'trees_registration' },
          ]);

          properties.map(({ publishedAt, ...p }) => {
            publishedAt.should.be.isoDate();
            return p;
          }).should.be.eql([
            { name: 'geometry', odataName: 'geometry', forms: [ { name: 'Register many trees', xmlFormId: 'trees_registration' } ] },
          ]);
        });
    }));
  });

  describe.skip('submission processing', () => {
    it('should parse multiple entities from submission', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(treesRepeat)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/trees_registration/submissions')
        .send(treesdata)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);
      /*
      await asAlice.get('/v1/projects/1/forms/trees_registration/submissions/one/audits')
        .expect(200)
        .then(() => {
          // TODO: should have multiple entities created
        });

      await asAlice.get('/v1/projects/1/datasets/plots/entities/12345678-1234-4123-8234-123456789aaa')
        .expect(200)
        .then(({ body }) => {
          // TODO: should have the correct data
          // currently failing
          body.currentVersion.data.should.eql({ geometry: 'gps123' });
        });
        */
    }));
  });
});
