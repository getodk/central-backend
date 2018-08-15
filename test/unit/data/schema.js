const appRoot = require('app-root-path');
const should = require('should');
const { getFormSchema, flattenSchemaStructures, _findRepeats, getSchemaTables, schemaAsLookup, stripNamespacesFromSchema, expectedFormAttachments } = require(appRoot + '/lib/data/schema');
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
      return getFormSchema({ xml }).then((schema) => {
        schema.should.eql([
          { name: 'name', type: 'string' },
          { name: 'age', type: 'int' },
          { name: 'hometown', type: 'select1' }
        ]);
      }).point();
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
      return getFormSchema({ xml }).then((schema) => {
        schema.should.eql([
          { name: 'name', type: 'string' },
          { name: 'age', type: 'int' },
          { name: 'hometown', type: 'select1' }
        ]);
      }).point();
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
      return getFormSchema({ xml }).then((schema) => {
        schema.should.eql([
          { name: 'orx:meta', type: 'structure', children: [
            { name: 'orx:instanceID', type: 'string' }
          ] },
          { name: 'name', type: 'string' },
          { name: 'age', type: 'int' }
        ]);
      }).point();
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
      return getFormSchema({ xml }).then((schema) => {
        schema.should.eql([
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
      }).point();
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
      return getFormSchema({ xml }).then((schema) => {
        schema.should.eql([
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
      }).point();
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
        return getFormSchema({ xml }).then((schema) => {
          flattenSchemaStructures(schema).should.eql([
            { path: [ 'name' ], type: 'string' },
            { path: [ 'occupation', 'title' ], type: 'string' },
            { path: [ 'occupation', 'salary' ], type: 'decimal' },
            { path: [ 'occupation', 'dates', 'joined' ], type: 'date' },
            { path: [ 'occupation', 'dates', 'departed' ], type: 'date' }
          ]);
        }).point();
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
        return getFormSchema({ xml }).then((schema) => {
          flattenSchemaStructures(schema).should.eql([
            { path: [ 'name' ], type: 'string' },
            { path: [ 'occupation', 'title' ], type: 'string' },
            { path: [ 'occupation', 'reports', 'report' ], type: 'repeat', children: [
              { path: [ 'name' ], type: 'string' },
              { path: [ 'project', 'name' ], type: 'string' },
              { path: [ 'project', 'due' ], type: 'date' }
            ] }
          ]);
        }).point();
      });
    });

    describe('table listing', () => {
      it('should return nothing for a schema without repeats', () =>
        getFormSchema({ xml: testData.forms.simple }).then((schema) => {
          getSchemaTables(schema).should.eql([]);
        }).point());

      it('should return relevant tables', () =>
        getFormSchema({ xml: testData.forms.doubleRepeat }).then((schema) => {
          getSchemaTables(schema).should.eql([
            'children.child',
            'children.child.toys.toy'
          ]);
        }).point());
    });

    describe('lookup', () => {
      it('should flatten basic and group bindings into lookups', () =>
        getFormSchema({ xml: testData.forms.simple }).then((schema) => {
          schemaAsLookup(schema).should.eql({
            meta: { name: 'meta', type: 'structure', children: {
              instanceID: { name: 'instanceID', type: 'string' } }
            },
            name: { name: 'name', type: 'string' },
            age: { name: 'age', type: 'int' }
          });
        }).point());

      it('should flatten repeat bindings into lookups', () =>
        getFormSchema({ xml: testData.forms.withrepeat }).then((schema) => {
          schemaAsLookup(schema).should.eql({
            'orx:meta': { name: 'orx:meta', type: 'structure', children: {
              'orx:instanceID': { name: 'orx:instanceID', type: 'string' }
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
        }).point());
    });
  });

  describe('stripNamespacesFromSchema', () => {
    it('should strip namespaces from multiple depths and leave normal tags alone', () => {
      stripNamespacesFromSchema([{
        name: 'orx:meta',
        type: 'structure',
        children: [{
          name: 'orx:instanceID',
          type: 'string'
        }]
      }, {
        name: 'age',
        type: 'int'
      }]).should.eql([{
        name: 'meta',
        type: 'structure',
        children: [{
          name: 'instanceID',
          type: 'string'
        }]
      }, {
        name: 'age',
        type: 'int'
      }]);
    });
  });

  describe('expectedFormAttachments', () => {
    it('should find secondary external instance srcs', () => {
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
              <instance id="mydata" src="jr://file/mydata.csv"/>
              <instance id="seconddata" src="jr://file-csv/seconddata.csv"/>
              <bind nodeset="/data/name" type="string"/>
              <bind type="int" nodeset="/data/age"/>
              <bind nodeset="/data/hometown" type="select1"/>
            </model>
          </h:head>
        </h:html>`;
      return expectedFormAttachments(xml).then((attachments) => {
        attachments.should.eql([
          { type: 'file', name: 'mydata.csv' },
          { type: 'file', name: 'seconddata.csv' }
        ]);
      }).point();
    });

    it('should ignore broken external instance srcs', () => {
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
              <instance id="mydata" src="coolfile.xls"/>
              <instance id="seconddata" src="jr://files/seconddata.csv"/>
              <instance id="thirddata" src="jr://file/goodfile.csv"/>
              <instance id="fourthdata" src="jr://file/path/to/nestedfile.csv"/>
              <instance id="fourthdata" src="jr://audio/mispathed.csv"/>
              <bind nodeset="/data/name" type="string"/>
              <bind type="int" nodeset="/data/age"/>
              <bind nodeset="/data/hometown" type="select1"/>
            </model>
          </h:head>
        </h:html>`;
      return expectedFormAttachments(xml).then((attachments) => {
        attachments.should.eql([
          { type: 'file', name: 'goodfile.csv' },
          { type: 'file', name: 'mispathed.csv' }
        ]);
      }).point();
    });

    it('should find media label files', () => {
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
              <itext>
                <translation default="true()" lang="en">
                  <text id="/data/name:label">
                    <value form="image">jr://images/name.jpg</value>
                  </text>
                  <text id="/data/age:label">
                    <value form="audio">jr://audio/age.mp3</value>
                  </text>
                  <text id="/data/hometown:label">
                    <value form="video">jr://video/hometown.mp4</value>
                  </text>
                </translation>
              </itext>
            </model>
          </h:head>
        </h:html>`;
      return expectedFormAttachments(xml).then((attachments) => {
        attachments.should.eql([
          { type: 'image', name: 'name.jpg' },
          { type: 'audio', name: 'age.mp3' },
          { type: 'video', name: 'hometown.mp4' }
        ]);
      }).point();
    });

    it('should interpret big-image as image and ignore other media form types', () => {
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
              <itext>
                <translation default="true()" lang="en">
                  <text id="/data/name:label">
                    <value form="big-image">jr://images/name.jpg</value>
                  </text>
                  <text id="/data/age:label">
                    <value form="something">jr://something/age.mp3</value>
                  </text>
                  <text id="/data/hometown:label">
                    <value form="file">jr://file/hometown.mp4</value>
                  </text>
                </translation>
              </itext>
            </model>
          </h:head>
        </h:html>`;
      return expectedFormAttachments(xml).then((attachments) => {
        attachments.should.eql([ { type: 'image', name: 'name.jpg' } ]);
      }).point();
    });

    it('should detect the need for itemsets.csv', () => {
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
          <h:body>
            <input query="instance('counties')/root/item[state=/select_one_external1/state ]" ref="/select_one_external1/county">
              <label ref="jr:itext('/select_one_external1/county:label')"/>
            </input>
          </h:body>
        </h:html>`;
      return expectedFormAttachments(xml).then((attachments) => {
        attachments.should.eql([{ type: 'file', name: 'itemsets.csv' }]);
      }).point();
    });

    it('should deduplicate identical (name, type) pairs', () => {
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
              <itext>
                <translation default="true()" lang="en">
                  <text id="/data/name:label">
                    <value form="image">jr://images/name.jpg</value>
                  </text>
                  <text id="/data/age:label">
                    <value form="image">jr://images/name.jpg</value>
                  </text>
                  <text id="/data/hometown:label">
                    <value form="video">jr://video/hometown.mp4</value>
                  </text>
                </translation>
              </itext>
            </model>
          </h:head>
        </h:html>`;
      return expectedFormAttachments(xml).then((attachments) => {
        attachments.should.eql([
          { type: 'image', name: 'name.jpg' },
          { type: 'video', name: 'hometown.mp4' }
        ]);
      }).point();
    });

    it('should not deduplicate identical names with different types', () => {
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
              <itext>
                <translation default="true()" lang="en">
                  <text id="/data/name:label">
                    <value form="image">jr://images/name.file</value>
                  </text>
                  <text id="/data/age:label">
                    <value form="audio">jr://images/name.file</value>
                  </text>
                  <text id="/data/hometown:label">
                    <value form="video">jr://video/hometown.mp4</value>
                  </text>
                </translation>
              </itext>
            </model>
          </h:head>
        </h:html>`;
      return expectedFormAttachments(xml).then((attachments) => {
        attachments.should.eql([
          { type: 'image', name: 'name.file' },
          { type: 'audio', name: 'name.file' },
          { type: 'video', name: 'hometown.mp4' }
        ]);
      }).point();
    });
  });
});

