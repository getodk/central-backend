const appRoot = require('app-root-path');
const should = require('should');
const { getFormSchema, flattenSchemaStructures, _findRepeats, schemaAsLookup } = require(appRoot + '/lib/data/schema');
const { toTraversable } = require(appRoot + '/lib/util/xml');
const testData = require(appRoot + '/test/integration/data'); // TODO: probably misplaced.

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
              <bind type="int" nodeset="/data/age"/>
              <bind nodeset="/data/hometown" type="select1"/>
            </model>
          </h:head>
        </h:html>`;
      getFormSchema({ xml }).should.eql([
        { name: 'name', type: 'string' },
        { name: 'age', type: 'int' },
        { name: 'hometown', type: 'select1' }
      ]);
    });

    it('should work with relative paths', () => {
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
              <bind nodeset="name" type="string"/>
              <bind type="int" nodeset="age"/>
              <bind nodeset="hometown" type="select1"/>
            </model>
          </h:head>
        </h:html>`;
      getFormSchema({ xml }).should.eql([
        { name: 'name', type: 'string' },
        { name: 'age', type: 'int' },
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
              <bind type="int" nodeset="/data/age"/>
            </model>
          </h:head>
        </h:html>`;
      getFormSchema({ xml }).should.eql([
        { name: 'meta', type: 'structure', children: [
          { name: 'instanceID', type: 'string' }
        ] },
        { name: 'name', type: 'string' },
        { name: 'age', type: 'int' }
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
                    <child>
                      <name/>
                      <toy>
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
          <h:body>
            <input ref="/data/name">
              <label>What is your name?</label>
            </input>
            <group ref="/data/children/child">
              <label>Child</label>
              <repeat nodeset="/data/children/child">
                <input ref="/data/children/child/name">
                  <label>What is the child's name?</label>
                </input>
                <group ref="/data/children/child/toy">
                  <label>Child</label>
                  <repeat nodeset="/data/children/child/toy">
                    <input ref="/data/children/child/toy/name">
                      <label>What is the toy's name?</label>
                    </input>
                  </repeat>
                </group>
              </repeat>
            </group>
          </h:body>
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

    describe('repeat locator', () => {
      it('should find repeat nodes', () => {
        const xml = `
          <body>
            <input/>
            <group>
              <repeat nodeset="one">
                <repeat nodeset="two"/>
                <group>
                  <repeat nodeset="three">
                    <input/>
                  </repeat>
                </group>
              </repeat>
            </group>
          </body>`;
        _findRepeats(toTraversable(xml)).should.eql([ 'one', 'two', 'three' ]);
      });

      it('does not crash given no body node', () => {
        _findRepeats(null).should.eql([]);
        _findRepeats(undefined).should.eql([]);
      });

      it('does not crash given a repeat with no nodeset', () => {
        const xml = `
          <body>
            <repeat/>
            <repeat>
              <repeat nodeset="four"/>
            </repeat>
          </body>`;
        _findRepeats(toTraversable(xml)).should.eql([ 'four' ]);
      });
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
            <h:body>
              <input ref="/data/name">
                <label>What is your name?</label>
              </input>
              <input ref="/data/occupation/title">
                <label>What is your job title?</label>
              </input>
              <group ref="/data/occupation/reports">
                <label>Report</label>
                <repeat nodeset="/data/occupation/reports/report">
                  <input ref="/data/occupation/reports/report/name">
                    <label>What is the report's name?</label>
                  </input>
                  <input ref="/data/occupation/reports/report/project/name">
                    <label>What is the report's current project?</label>
                  </input>
                  <input ref="/data/occupation/reports/report/project/due">
                    <label>When is the report's current project due?</label>
                  </input>
                </repeat>
              </group>
            </h:body>
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

    describe('lookup', () => {
      it('should flatten basic and group bindings into lookups', () => {
        schemaAsLookup(getFormSchema({ xml: testData.forms.simple })).should.eql({
          meta: { name: 'meta', type: 'structure', children: {
            instanceID: { name: 'instanceID', type: 'string' } }
          },
          name: { name: 'name', type: 'string' },
          age: { name: 'age', type: 'int' }
        });
      });

      it('should flatten repeat bindings into lookups', () => {
        schemaAsLookup(getFormSchema({ xml: testData.forms.withrepeat })).should.eql({
          meta: { name: 'meta', type: 'structure', children: {
            instanceID: { name: 'instanceID', type: 'string' }
          } },
          name: { name: 'name', type: 'string' },
          age: { name: 'age', type: 'int' },
          children: { name: 'children', type: 'structure', children: {
            child: { name: 'child', type: 'repeat', children: {
              name: { name: 'name', type: 'string' },
              age: { name: 'age', type: 'int' }
            } }
          } }
        });
      });
    });
  });
});

