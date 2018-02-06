const should = require('should');
const { getFormSchema, flattenSchemaStructures } = require('../../../lib/data/schema');

describe('form schema', () => {
  describe('parsing', () => {
    it('should retrieve a set of fields with their names and types', () => {
      const xml = `
        <?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
          <h:head>
            <model>
              <instance>
                <data id="form">
                  <name/>
                  <age/>
                  <hometown/>
                </data>
              </instance>
              <bind nodeset="/data/name" type="string"/>
              <bind type="integer" nodeset="/data/age"/>
              <bind nodeset="/data/hometown" type="select1"/>
            </model>
          </h:head>
        </h:html>`;
      getFormSchema({ xml }).should.eql([
        { name: 'name', type: 'string' },
        { name: 'age', type: 'integer' },
        { name: 'hometown', type: 'select1' }
      ]);
    });

    it('should handle namespaced bindings correctly', () => {
      const xml = `
        <?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
          <h:head>
            <model>
              <instance>
                <data id="form">
                  <orx:meta>
                    <orx:instanceID/>
                  </orx:meta>
                  <name/>
                  <age/>
                </data>
              </instance>
              <bind nodeset="/data/orx:meta/orx:instanceID" type="string"/>
              <bind nodeset="/data/name" type="string"/>
              <bind type="integer" nodeset="/data/age"/>
            </model>
          </h:head>
        </h:html>`;
      getFormSchema({ xml }).should.eql([
        { name: 'meta', type: 'structure', children: [
          { name: 'instanceID', type: 'string' }
        ] },
        { name: 'name', type: 'string' },
        { name: 'age', type: 'integer' }
      ]);
    });

    it('should deal correctly with nonbinding nested nodes', () => {
      const xml = `
        <?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
          <h:head>
            <model>
              <instance>
                <data id="form">
                  <name/>
                  <occupation>
                    <title/>
                    <salary/>
                    <dates>
                      <joined/>
                      <departed/>
                    </dates>
                  </occupation>
                </data>
              </instance>
              <bind nodeset="/data/name" type="string"/>
              <bind nodeset="/data/occupation/title" type="string"/>
              <bind nodeset="/data/occupation/salary" type="decimal"/>
              <bind nodeset="/data/occupation/dates/joined" type="date"/>
              <bind nodeset="/data/occupation/dates/departed" type="date"/>
            </model>
          </h:head>
        </h:html>`;
      getFormSchema({ xml }).should.eql([
        { name: 'name', type: 'string' },
        { name: 'occupation', type: 'structure', children: [
          { name: 'title', type: 'string' },
          { name: 'salary', type: 'decimal' },
          { name: 'dates', type: 'structure', children: [
            { name: 'joined', type: 'date' },
            { name: 'departed', type: 'date' }
          ] }
        ] }
      ]);
    });

    it('should deal correctly with repeats', () => {
      const xml = `
        <?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
          <h:head>
            <model>
              <instance>
                <data id="form">
                  <name/>
                  <children>
                    <child jr:template="">
                      <name/>
                      <toy jr:template="">
                        <name/>
                      </toy>
                    </child>
                  </children>
                </data>
              </instance>
              <bind nodeset="/data/name" type="string"/>
              <bind nodeset="/data/children/child/name" type="string"/>
              <bind nodeset="/data/children/child/toy/name" type="string"/>
            </model>
          </h:head>
        </h:html>`;
      getFormSchema({ xml }).should.eql([
        { name: 'name', type: 'string' },
        { name: 'children', type: 'structure', children: [
          { name: 'child', type: 'repeat', children: [
            { name: 'name', type: 'string' },
            { name: 'toy', type: 'repeat', children: [
              { name: 'name', type: 'string' }
            ] }
          ] }
        ] }
      ]);
    });
  });

  describe('transformation', () => {
    describe('flatten', () => {
      it('should flatten direct structures', () => {
        const xml = `
          <?xml version="1.0"?>
          <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
            <h:head>
              <model>
                <instance>
                  <data id="form">
                    <name/>
                    <occupation>
                      <title/>
                      <salary/>
                      <dates>
                        <joined/>
                        <departed/>
                      </dates>
                    </occupation>
                  </data>
                </instance>
                <bind nodeset="/data/name" type="string"/>
                <bind nodeset="/data/occupation/title" type="string"/>
                <bind nodeset="/data/occupation/salary" type="decimal"/>
                <bind nodeset="/data/occupation/dates/joined" type="date"/>
                <bind nodeset="/data/occupation/dates/departed" type="date"/>
              </model>
            </h:head>
          </h:html>`;
        flattenSchemaStructures(getFormSchema({ xml })).should.eql([
          { path: [ 'name' ], type: 'string' },
          { path: [ 'occupation', 'title' ], type: 'string' },
          { path: [ 'occupation', 'salary' ], type: 'decimal' },
          { path: [ 'occupation', 'dates', 'joined' ], type: 'date' },
          { path: [ 'occupation', 'dates', 'departed' ], type: 'date' }
        ]);
      });

      it('should flatten repeat-nested structures', () => {
        const xml = `
          <?xml version="1.0"?>
          <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
            <h:head>
              <model>
                <instance>
                  <data id="form">
                    <name/>
                    <occupation>
                      <title/>
                      <reports>
                        <report jr:template="">
                          <name/>
                          <project>
                            <name/>
                            <due/>
                          </project>
                        </report>
                      </reports>
                    </occupation>
                  </data>
                </instance>
                <bind nodeset="/data/name" type="string"/>
                <bind nodeset="/data/occupation/title" type="string"/>
                <bind nodeset="/data/occupation/reports/report/name" type="string"/>
                <bind nodeset="/data/occupation/reports/report/project/name" type="string"/>
                <bind nodeset="/data/occupation/reports/report/project/due" type="date"/>
              </model>
            </h:head>
          </h:html>`;
        flattenSchemaStructures(getFormSchema({ xml })).should.eql([
          { path: [ 'name' ], type: 'string' },
          { path: [ 'occupation', 'title' ], type: 'string' },
          { path: [ 'occupation', 'reports', 'report' ], type: 'repeat', children: [
            { path: [ 'name' ], type: 'string' },
            { path: [ 'project', 'name' ], type: 'string' },
            { path: [ 'project', 'due' ], type: 'date' }
          ] }
        ]);
      });
    });
  });
});

