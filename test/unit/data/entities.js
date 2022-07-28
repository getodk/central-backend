const appRoot = require('app-root-path');
const { getEntityDef, getEntityFromSub, getEntityUsingFields } = require(appRoot + '/lib/data/entities');
const testData = require(appRoot + '/test/data/xml');
const { fieldsFor, MockField } = require(appRoot + '/test/util/schema');
const should = require('should');

describe('entity parsing', () => {
  describe('entity form def spec', () => {
    it('should extract name and entity field mappings', async () => {
      const entityDef = await getEntityDef(testData.forms.simpleEntity);
      entityDef.should.eql({
        dataset: 'people',
        mapping: [
          { path: '/name', entity_prop: 'full_name' },
          { path: '/age', entity_prop: 'age' }
        ]
      });
    });

    it('should map nested fields to entity properties through binds', async () => {
      const xml = `
      <?xml version="1.0"?>
      <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
        <h:head>
          <model>
            <instance>
              <data id="form">
                <name/>
                <location_info>
                  <location_name/>
                  <location_gps/>
                  <location_image/>
                </location_info>
                <meta>
                  <entity entities:dataset="people_places">
                    <entities:create/>
                    <entities:label/>
                  </entity>
                </meta>
              </data>
            </instance>
            <bind nodeset="/data/name" type="string" entities:ref="full_name"/>
            <bind nodeset="/data/location_info/location_name" type="string" entities:ref="location"/>
          </model>
        </h:head>
      </h:html>`;
      const entityDef = await getEntityDef(xml);
      entityDef.should.eql({
        dataset: 'people_places',
        mapping: [
          { path: '/name', entity_prop: 'full_name' },
          { path: '/location_info/location_name', entity_prop: 'location' }
        ]
      });
    });

    it('should return null entity if entity not defined in form', async () => {
      const entityDef = await getEntityDef(testData.forms.simple);
      should.not.exist(entityDef);
    });

    describe('entities: namespace prefix', () => {
      it.skip('should fail if entities namespace missing on entity', async () => {
        const xml = `
        <?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
          <h:head>
            <model>
              <instance>
                <data id="form">
                  <meta>
                    <entity entities:dataset="people">
                    </entity>
                  </meta>
                </data>
              </instance>
            </model>
          </h:head>
        </h:html>`;
        const entityDef = await getEntityDef(xml);
        entityDef.should.eql({});
      });

      it.skip('should fail if entities namespace missing on dataset', async () => {
        const xml = `
        <?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
          <h:head>
            <model>
              <instance>
                <data id="form">
                  <meta>
                    <entities:entity dataset="people">
                    </entity>
                  </meta>
                </data>
              </instance>
            </model>
          </h:head>
        </h:html>`;
        const entityDef = await getEntityDef(xml);
        entityDef.should.eql({});
      });

      it('should require entities namespace prefix on refs to be included', async () => {
        const xml = `<?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
          <h:head>
            <model>
              <instance>
                <data id="form">
                  <name/>
                  <age/>
                  <meta>
                    <entities:entity entities:dataset="people">
                    </entities:entity>
                  </meta>
                </data>
              </instance>
              <bind nodeset="/data/name" type="string" ref="full_name"/>
              <bind nodeset="/data/age" type="string" entities:ref="age"/>
            </model>
          </h:head>
        </h:html>`;
        const entityDef = await getEntityDef(xml);
        entityDef.should.eql({
          dataset: 'people',
          mapping: [
            { path: '/age', entity_prop: 'age' }
          ]
        });
      });
    });
  });

  describe('entity submission', () => {
    it('should get entity properties out of submission', async () => {
      const entityDef = await getEntityDef(testData.forms.simpleEntity);
      const fields = entityDef.mapping;
      const data = await getEntityFromSub(fields, testData.instances.simpleEntity.one);
      data.should.eql({ label: 'Betty (94)', full_name: 'Betty', age: '94' });
    });

    it('should get entity props out of submission another way using fields', async () => {
      const fields = await fieldsFor(testData.forms.simpleEntity);
      const data = await getEntityUsingFields(fields, testData.instances.simpleEntity.one);
      data.should.eql({ label: 'Betty (94)', full_name: 'Betty', age: '94' });
    });
  });
});
