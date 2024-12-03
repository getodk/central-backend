const appRoot = require('app-root-path');
const { getFieldTree, getChildren } = require('../../../lib/formats/odata');
const streamTest = require('streamtest').v2;
const { serviceDocumentFor, edmxFor, rowStreamToOData, singleRowToOData, selectFields } = require(appRoot + '/lib/formats/odata');
const { fieldsFor, MockField } = require(appRoot + '/test/util/schema');
const testData = require(appRoot + '/test/data/xml');
const should = require('should');
const { QueryOptions } = require('../../../lib/util/db');
const Problem = require(appRoot + '/lib/util/problem');

// Helpers to deal with repeated system metadata generation.
const submitter = { id: 5, displayName: 'Alice' };
const attachment = { present: 1, expected: 2 };
const __system = {
  submissionDate: '2017-09-20T17:10:43Z',
  updatedAt: null,
  submitterId: submitter.id.toString(),
  submitterName: submitter.displayName,
  attachmentsPresent: 1,
  attachmentsExpected: 2,
  status: null,
  reviewState: null,
  deviceId: null,
  edits: 0,
  formVersion: ''
};
const mockSubmission = (instanceId, xml) => ({
  xml,
  instanceId,
  createdAt: __system.submissionDate,
  updatedAt: null,
  def: {},
  aux: { submitter, attachment, encryption: {}, edit: { count: 0 }, exports: { formVersion: '' } }
});

describe('odata message composition', () => {
  describe('service document', () => {
    it('should return the correct metadata context', () => {
      const doc = serviceDocumentFor([], 'http://localhost:8989', '/forms/testform.svc');
      doc['@odata.context'].should.equal('http://localhost:8989/forms/testform.svc/$metadata');
    });

    it('should return the root table in all cases', () => {
      const doc = serviceDocumentFor([], 'http://localhost:8989', '/forms/simple.svc');
      doc.should.eql({
        '@odata.context': 'http://localhost:8989/forms/simple.svc/$metadata',
        value: [{ name: 'Submissions', kind: 'EntitySet', url: 'Submissions' }]
      });
    });

    it('should return all nested tables in addition to the root table', () =>
      fieldsFor(testData.forms.doubleRepeat).then((fields) => {
        const doc = serviceDocumentFor(fields, 'http://localhost:8989', '/forms/doubleRepeat.svc');
        doc.should.eql({
          '@odata.context': 'http://localhost:8989/forms/doubleRepeat.svc/$metadata',
          value: [
            { name: 'Submissions', kind: 'EntitySet', url: 'Submissions' },
            { name: 'Submissions.children.child', kind: 'EntitySet', url: 'Submissions.children.child' },
            { name: 'Submissions.children.child.toys.toy', kind: 'EntitySet', url: 'Submissions.children.child.toys.toy' }
          ]
        });
      }));
  });

  describe('metadata document', () => {
    // there is a LOT of content in our EDMX output because of our Capabilities declarations.
    // we don't try to test all of that comprehensively, we focus mostly on basic correctness
    // and the few branch cases there are.

    it('should return a basic metadata document', () => fieldsFor(testData.forms.simple).then((fields) => {
      edmxFor('simple', fields).should.startWith(`<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.submission">
      <ComplexType Name="metadata">
        <Property Name="submissionDate" Type="Edm.DateTimeOffset"/>
        <Property Name="updatedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="deletedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="submitterId" Type="Edm.String"/>
        <Property Name="submitterName" Type="Edm.String"/>
        <Property Name="attachmentsPresent" Type="Edm.Int64"/>
        <Property Name="attachmentsExpected" Type="Edm.Int64"/>
        <Property Name="status" Type="org.opendatakit.submission.Status"/>
        <Property Name="reviewState" Type="org.opendatakit.submission.ReviewState"/>
        <Property Name="deviceId" Type="Edm.String"/>
        <Property Name="edits" Type="Edm.Int64"/>
        <Property Name="formVersion" Type="Edm.String"/>
      </ComplexType>
      <EnumType Name="Status">
        <Member Name="notDecrypted"/>
        <Member Name="missingEncryptedFormData"/>
      </EnumType>
      <EnumType Name="ReviewState">
        <Member Name="hasIssues"/>
        <Member Name="edited"/>
        <Member Name="rejected"/>
        <Member Name="approved"/>
      </EnumType>
    </Schema>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.user.simple">
      <EntityType Name="Submissions">
        <Key><PropertyRef Name="__id"/></Key>
        <Property Name="__id" Type="Edm.String"/>
        <Property Name="__system" Type="org.opendatakit.submission.metadata"/>
        <Property Name="meta" Type="org.opendatakit.user.simple.meta"/>
        <Property Name="name" Type="Edm.String"/>
        <Property Name="age" Type="Edm.Int64"/>
      </EntityType>
      <ComplexType Name="meta">
        <Property Name="instanceID" Type="Edm.String"/>
      </ComplexType>
      <EntityContainer Name="simple">
        <EntitySet Name="Submissions" EntityType="org.opendatakit.user.simple.Submissions">`);
    }));

    it('should sanitize nasty xmlFormIds', () => fieldsFor(testData.forms.withrepeat).then((fields) => {
      edmxFor('my!awesome!form!!', fields).should.startWith(`<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.submission">
      <ComplexType Name="metadata">
        <Property Name="submissionDate" Type="Edm.DateTimeOffset"/>
        <Property Name="updatedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="deletedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="submitterId" Type="Edm.String"/>
        <Property Name="submitterName" Type="Edm.String"/>
        <Property Name="attachmentsPresent" Type="Edm.Int64"/>
        <Property Name="attachmentsExpected" Type="Edm.Int64"/>
        <Property Name="status" Type="org.opendatakit.submission.Status"/>
        <Property Name="reviewState" Type="org.opendatakit.submission.ReviewState"/>
        <Property Name="deviceId" Type="Edm.String"/>
        <Property Name="edits" Type="Edm.Int64"/>
        <Property Name="formVersion" Type="Edm.String"/>
      </ComplexType>
      <EnumType Name="Status">
        <Member Name="notDecrypted"/>
        <Member Name="missingEncryptedFormData"/>
      </EnumType>
      <EnumType Name="ReviewState">
        <Member Name="hasIssues"/>
        <Member Name="edited"/>
        <Member Name="rejected"/>
        <Member Name="approved"/>
      </EnumType>
    </Schema>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.user.my_awesome_form_">`);
    }));

    it('should yield all the correct data types', () =>
      fieldsFor(`<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <h:title>Types</h:title>
    <model>
      <instance>
        <data id="types">
          <meta><instanceID/></meta>
          <string/><int/><boolean/><decimal/><date/><time/><dateTime/>
          <geopoint/><geotrace/><geoshape/><binary/><barcode/><intent/>
        </data>
      </instance>

      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
      <bind nodeset="/data/string" type="string"/>
      <bind nodeset="/data/int" type="int"/>
      <bind nodeset="/data/boolean" type="boolean"/>
      <bind nodeset="/data/decimal" type="decimal"/>
      <bind nodeset="/data/date" type="date"/>
      <bind nodeset="/data/time" type="time"/>
      <bind nodeset="/data/dateTime" type="dateTime"/>
      <bind nodeset="/data/geopoint" type="geopoint"/>
      <bind nodeset="/data/geotrace" type="geotrace"/>
      <bind nodeset="/data/geoshape" type="geoshape"/>
      <bind nodeset="/data/binary" type="binary"/>
      <bind nodeset="/data/barcode" type="barcode"/>
      <bind nodeset="/data/intent" type="intent"/>
    </model>
  </h:head>
  <h:body/>
</h:html>`).then((fields) => {
        const edmx = edmxFor('types', fields);
        edmx.should.startWith(`<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.submission">
      <ComplexType Name="metadata">
        <Property Name="submissionDate" Type="Edm.DateTimeOffset"/>
        <Property Name="updatedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="deletedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="submitterId" Type="Edm.String"/>
        <Property Name="submitterName" Type="Edm.String"/>
        <Property Name="attachmentsPresent" Type="Edm.Int64"/>
        <Property Name="attachmentsExpected" Type="Edm.Int64"/>
        <Property Name="status" Type="org.opendatakit.submission.Status"/>
        <Property Name="reviewState" Type="org.opendatakit.submission.ReviewState"/>
        <Property Name="deviceId" Type="Edm.String"/>
        <Property Name="edits" Type="Edm.Int64"/>
        <Property Name="formVersion" Type="Edm.String"/>
      </ComplexType>
      <EnumType Name="Status">
        <Member Name="notDecrypted"/>
        <Member Name="missingEncryptedFormData"/>
      </EnumType>
      <EnumType Name="ReviewState">
        <Member Name="hasIssues"/>
        <Member Name="edited"/>
        <Member Name="rejected"/>
        <Member Name="approved"/>
      </EnumType>
    </Schema>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.user.types">
      <EntityType Name="Submissions">
        <Key><PropertyRef Name="__id"/></Key>
        <Property Name="__id" Type="Edm.String"/>
        <Property Name="__system" Type="org.opendatakit.submission.metadata"/>
        <Property Name="meta" Type="org.opendatakit.user.types.meta"/>
        <Property Name="string" Type="Edm.String"/>
        <Property Name="int" Type="Edm.Int64"/>
        <Property Name="boolean" Type="Edm.Boolean"/>
        <Property Name="decimal" Type="Edm.Decimal"/>
        <Property Name="date" Type="Edm.Date"/>
        <Property Name="time" Type="Edm.String"/>
        <Property Name="dateTime" Type="Edm.DateTimeOffset"/>
        <Property Name="geopoint" Type="Edm.GeographyPoint"/>
        <Property Name="geotrace" Type="Edm.GeographyLineString"/>
        <Property Name="geoshape" Type="Edm.GeographyPolygon"/>
        <Property Name="binary" Type="Edm.String"/>
        <Property Name="barcode" Type="Edm.String"/>
        <Property Name="intent" Type="Edm.String"/>
      </EntityType>`);
      }));

    it('should express repeats as entity types behind navigation properties', () =>
      fieldsFor(testData.forms.withrepeat).then((fields) => {
        const edmx = edmxFor('withrepeat', fields);
        edmx.should.startWith(`<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.submission">
      <ComplexType Name="metadata">
        <Property Name="submissionDate" Type="Edm.DateTimeOffset"/>
        <Property Name="updatedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="deletedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="submitterId" Type="Edm.String"/>
        <Property Name="submitterName" Type="Edm.String"/>
        <Property Name="attachmentsPresent" Type="Edm.Int64"/>
        <Property Name="attachmentsExpected" Type="Edm.Int64"/>
        <Property Name="status" Type="org.opendatakit.submission.Status"/>
        <Property Name="reviewState" Type="org.opendatakit.submission.ReviewState"/>
        <Property Name="deviceId" Type="Edm.String"/>
        <Property Name="edits" Type="Edm.Int64"/>
        <Property Name="formVersion" Type="Edm.String"/>
      </ComplexType>
      <EnumType Name="Status">
        <Member Name="notDecrypted"/>
        <Member Name="missingEncryptedFormData"/>
      </EnumType>
      <EnumType Name="ReviewState">
        <Member Name="hasIssues"/>
        <Member Name="edited"/>
        <Member Name="rejected"/>
        <Member Name="approved"/>
      </EnumType>
    </Schema>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.user.withrepeat">
      <EntityType Name="Submissions">
        <Key><PropertyRef Name="__id"/></Key>
        <Property Name="__id" Type="Edm.String"/>
        <Property Name="__system" Type="org.opendatakit.submission.metadata"/>
        <Property Name="meta" Type="org.opendatakit.user.withrepeat.meta"/>
        <Property Name="name" Type="Edm.String"/>
        <Property Name="age" Type="Edm.Int64"/>
        <Property Name="children" Type="org.opendatakit.user.withrepeat.children"/>
      </EntityType>
      <EntityType Name="Submissions.children.child">
        <Key><PropertyRef Name="__id"/></Key>
        <Property Name="__id" Type="Edm.String"/>
        <Property Name="__Submissions-id" Type="Edm.String"/>
        <Property Name="name" Type="Edm.String"/>
        <Property Name="age" Type="Edm.Int64"/>
      </EntityType>
      <ComplexType Name="meta">
        <Property Name="instanceID" Type="Edm.String"/>
      </ComplexType>
      <ComplexType Name="children">
        <NavigationProperty Name="child" Type="Collection(org.opendatakit.user.withrepeat.Submissions.children.child)"/>
      </ComplexType>
      <EntityContainer Name="withrepeat">
        <EntitySet Name="Submissions" EntityType="org.opendatakit.user.withrepeat.Submissions">`);

        edmx.should.endWith(`<EntitySet Name="Submissions.children.child" EntityType="org.opendatakit.user.withrepeat.Submissions.children.child">
        </EntitySet>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`);
      }));

    it('should express repeats as entitysets', () => fieldsFor(testData.forms.withrepeat).then((fields) => {
      edmxFor('withrepeat', fields).should.endWith(`<EntitySet Name="Submissions.children.child" EntityType="org.opendatakit.user.withrepeat.Submissions.children.child">
        </EntitySet>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`);
    }));

    it('should appropriately name repeat-parent join ids', () => fieldsFor(testData.forms.doubleRepeat).then((fields) => {
      edmxFor('double', fields).includes(`<EntityType Name="Submissions.children.child.toys.toy">
        <Key><PropertyRef Name="__id"/></Key>
        <Property Name="__id" Type="Edm.String"/>
        <Property Name="__Submissions-children-child-id" Type="Edm.String"/>`).should.equal(true);
    }));

    it('should appropriately sanitize identifiers', () => fieldsFor(`<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <h:title>Illegal OData Chars</h:title>
    <model>
      <instance>
        <data id="sanitize">
          <meta>
            <instanceID/>
          </meta>
          <q1.8/>
          <42/>
          <2.4><q3.6><a/></q3.6></2.4>
        </data>
      </instance>

      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
      <bind nodeset="/data/q1.8" type="string"/>
      <bind nodeset="/data/42" type="int"/>
      <bind nodeset="/data/2.4/a" type="string"/>
    </model>

  </h:head>
  <h:body>
    <input ref="/data/q1.8">
      <label>What is your name?</label>
    </input>
    <input ref="/data/42">
      <label>What is your age?</label>
    </input>
    <group ref="/data/2.4">
      <label>2.4 group</label>
      <repeat nodeset="/data/2.4/q3.6">
        <input ref="/data/2.4/a">
          <label>a?</label>
        </input>
      </repeat>
    </group>
  </h:body>
</h:html>`).then((fields) => {
      const edmx = edmxFor('sanitize', fields);
      edmx.includes('<Property Name="q1_8" Type="Edm.String"/>').should.equal(true);
      edmx.includes('<Property Name="_42" Type="Edm.Int64"/>').should.equal(true);
      edmx.includes('<Property Name="_2_4" Type="org.opendatakit.user.sanitize._2_4"/>').should.equal(true);
      edmx.includes('<ComplexType Name="_2_4">').should.equal(true);
      edmx.includes('<EntityType Name="Submissions._2_4.q3_6">').should.equal(true);
    }));

    it('should not be fooled by path prefix extensions', () => fieldsFor(`<?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
          <h:head>
            <model>
              <instance>
                <data id="form">
                  <name/>
                  <children jr:template="">
                    <name/>
                  </children>
                  <children-status/>
                </data>
              </instance>
              <bind nodeset="/data/name" type="string"/>
              <bind nodeset="/data/children/name" type="string"/>
              <bind nodeset="/data/children-status" type="select1"/>
            </model>
          </h:head>
          <h:body>
            <repeat nodeset="/data/children">
              <input ref="/data/children/name">
                <label>What is the child's name?</label>
              </input>
            </repeat>
          </h:body>
        </h:html>`).then((fields) => {
      const edmx = edmxFor('pathprefix', fields);
      edmx.should.startWith(`<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.submission">
      <ComplexType Name="metadata">
        <Property Name="submissionDate" Type="Edm.DateTimeOffset"/>
        <Property Name="updatedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="deletedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="submitterId" Type="Edm.String"/>
        <Property Name="submitterName" Type="Edm.String"/>
        <Property Name="attachmentsPresent" Type="Edm.Int64"/>
        <Property Name="attachmentsExpected" Type="Edm.Int64"/>
        <Property Name="status" Type="org.opendatakit.submission.Status"/>
        <Property Name="reviewState" Type="org.opendatakit.submission.ReviewState"/>
        <Property Name="deviceId" Type="Edm.String"/>
        <Property Name="edits" Type="Edm.Int64"/>
        <Property Name="formVersion" Type="Edm.String"/>
      </ComplexType>
      <EnumType Name="Status">
        <Member Name="notDecrypted"/>
        <Member Name="missingEncryptedFormData"/>
      </EnumType>
      <EnumType Name="ReviewState">
        <Member Name="hasIssues"/>
        <Member Name="edited"/>
        <Member Name="rejected"/>
        <Member Name="approved"/>
      </EnumType>
    </Schema>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.user.pathprefix">
      <EntityType Name="Submissions">
        <Key><PropertyRef Name="__id"/></Key>
        <Property Name="__id" Type="Edm.String"/>
        <Property Name="__system" Type="org.opendatakit.submission.metadata"/>
        <Property Name="name" Type="Edm.String"/>
        <NavigationProperty Name="children" Type="Collection(org.opendatakit.user.pathprefix.Submissions.children)"/>
        <Property Name="children_status" Type="Edm.String"/>
      </EntityType>
      <EntityType Name="Submissions.children">
        <Key><PropertyRef Name="__id"/></Key>
        <Property Name="__id" Type="Edm.String"/>
        <Property Name="__Submissions-id" Type="Edm.String"/>
        <Property Name="name" Type="Edm.String"/>
      </EntityType>
      <EntityContainer Name="pathprefix">`);
    }));

    it('should not be fooled by nested groups closing one after the other', () => fieldsFor(`<?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
          <h:head>
            <model>
              <instance>
                <data id="form">
                  <outer>
                    <inner>
                      <q1/>
                    </inner>
                  </outer>
                  <outside/>
                </data>
              </instance>
              <bind nodeset="/data/outer/inner/q1" type="string"/>
              <bind nodeset="/data/outside" type="string"/>
            </model>
          </h:head>
          <h:body>
            <group nodeset="/data/outer">
              <group nodeset="/data/outer/inner">
                <input ref="/data/outer/inner/q1">
                  <label>Foo</label>
                </input>
              </group>
            </group>
            <input ref="/data/outside">
              <label>Foo</label>
            </input>
          </h:body>
        </h:html>`).then((fields) => {
      const edmx = edmxFor('form', fields);
      edmx.should.startWith(`<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.submission">
      <ComplexType Name="metadata">
        <Property Name="submissionDate" Type="Edm.DateTimeOffset"/>
        <Property Name="updatedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="deletedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="submitterId" Type="Edm.String"/>
        <Property Name="submitterName" Type="Edm.String"/>
        <Property Name="attachmentsPresent" Type="Edm.Int64"/>
        <Property Name="attachmentsExpected" Type="Edm.Int64"/>
        <Property Name="status" Type="org.opendatakit.submission.Status"/>
        <Property Name="reviewState" Type="org.opendatakit.submission.ReviewState"/>
        <Property Name="deviceId" Type="Edm.String"/>
        <Property Name="edits" Type="Edm.Int64"/>
        <Property Name="formVersion" Type="Edm.String"/>
      </ComplexType>
      <EnumType Name="Status">
        <Member Name="notDecrypted"/>
        <Member Name="missingEncryptedFormData"/>
      </EnumType>
      <EnumType Name="ReviewState">
        <Member Name="hasIssues"/>
        <Member Name="edited"/>
        <Member Name="rejected"/>
        <Member Name="approved"/>
      </EnumType>
    </Schema>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.user.form">
      <EntityType Name="Submissions">
        <Key><PropertyRef Name="__id"/></Key>
        <Property Name="__id" Type="Edm.String"/>
        <Property Name="__system" Type="org.opendatakit.submission.metadata"/>
        <Property Name="outer" Type="org.opendatakit.user.form.outer"/>
        <Property Name="outside" Type="Edm.String"/>
      </EntityType>
      <ComplexType Name="outer">
        <Property Name="inner" Type="org.opendatakit.user.form.outer.inner"/>
      </ComplexType>
      <ComplexType Name="outer.inner">
        <Property Name="q1" Type="Edm.String"/>
      </ComplexType>`);
    }));
  });

  describe('rowstream conversion', () => {
    describe('table verification', () => {
      it('should reject with not found if the toplevel table is wrong', () => {
        const inRows = streamTest.fromObjects([]);
        return fieldsFor(testData.forms.simple).then((fields) =>
          rowStreamToOData(fields, 'Dummy', 'http://localhost:8989', '/simple.svc/Submissions', {}, inRows, 0))
          .should.be.rejected();
      });

      it('should reject with not found if a subtable is wrong', () => {
        const inRows = streamTest.fromObjects([]);
        return fieldsFor(testData.forms.withrepeat).then((fields) =>
          rowStreamToOData(fields, 'Submissions.nonexistent', 'http://localhost:8989', '/withrepeat.svc/Submissions.nonexistent', {}, inRows, 0))
          .should.be.rejected();
      });

      it('should pass if the toplevel table is correct', () => {
        const inRows = streamTest.fromObjects([]);
        return fieldsFor(testData.forms.withrepeat).then((fields) =>
          rowStreamToOData(fields, 'Submissions', 'http://localhost:8989', '/withrepeat.svc/Submissions', {}, inRows, 0))
          .should.not.be.rejected();
      });

      it('should pass if the subtable is correct', () => {
        const inRows = streamTest.fromObjects([]);
        return fieldsFor(testData.forms.withrepeat).then((fields) =>
          rowStreamToOData(fields, 'Submissions.children.child', 'http://localhost:8989', '/withrepeat.svc/Submissions.children.child', {}, inRows, 0))
          .should.not.be.rejected();
      });
    });

    describe('metadata generation', () => {
      it('should provide the correct context url for the toplevel table', (done) => {
        const inRows = streamTest.fromObjects([]);
        fieldsFor(testData.forms.simple)
          .then((fields) => rowStreamToOData(fields, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions', {}, inRows))
          .then((stream) => stream.pipe(streamTest.toText((_, result) => {
            const resultObj = JSON.parse(result);
            resultObj['@odata.context'].should.equal('http://localhost:8989/simple.svc/$metadata#Submissions');
            done();
          })));
      });

      it('should provide the correct context url for a subtable', (done) => {
        const inRows = streamTest.fromObjects([]);
        fieldsFor(testData.forms.withrepeat)
          .then((fields) => rowStreamToOData(fields, 'Submissions.children.child', 'http://localhost:8989', '/withrepeat.svc/Submissions', {}, inRows))
          .then((stream) => stream.pipe(streamTest.toText((_, result) => {
            const resultObj = JSON.parse(result);
            resultObj['@odata.context'].should.equal('http://localhost:8989/withrepeat.svc/$metadata#Submissions.children.child');
            done();
          })));
      });

      const instances = (count) => (new Array(count)).fill({ xml: '<data/>', def: {}, aux: { submitter, attachment, edit: { count: 0 }, exports: { formVersion: '' } } });
      it('should provide no nextUrl if the final row is accounted for', (done) => {
        const query = { $top: '3', $skip: '7' };
        const inRows = streamTest.fromObjects(instances(10));
        fieldsFor(testData.forms.simple)
          .then((fields) => rowStreamToOData(fields, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions?$top=3&$skip=7', query, inRows))
          .then((stream) => stream.pipe(streamTest.toText((_, result) => {
            const resultObj = JSON.parse(result);
            // eslint-disable-next-line no-undef
            should.not.exist(resultObj['@odata.nextLink']);
            done();
          })));
      });

      it('should provide the correct nextUrl if rows remain', (done) => {
        const query = { $top: '3', $skip: '2' };
        const inRows = streamTest.fromObjects(instances(6)); // make it close to check the off-by-one.
        fieldsFor(testData.forms.simple)
          .then((fields) => rowStreamToOData(fields, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions?$top=3&$skip=2', query, inRows, 10, 8))
          .then((stream) => stream.pipe(streamTest.toText((_, result) => {
            const resultObj = JSON.parse(result);
            resultObj['@odata.nextLink'].should.equal('http://localhost:8989/simple.svc/Submissions?%24top=3&%24skiptoken=01e30%3D');
            resultObj['@odata.nextLink'].should.have.skiptoken({});
            done();
          })));
      });

      it('should retain other parameters when giving the nextUrl', (done) => {
        const query = { $top: '3', $skip: '2', $wkt: 'true', $count: 'true' };
        const inRows = streamTest.fromObjects(instances(6)); // make it close to check the off-by-one.
        fieldsFor(testData.forms.simple)
          .then((fields) => rowStreamToOData(fields, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions?$top=3&$skip=2&$wkt=true&$count=true', query, inRows, 10, 8))
          .then((stream) => stream.pipe(streamTest.toText((_, result) => {
            const resultObj = JSON.parse(result);
            resultObj['@odata.nextLink'].should.equal('http://localhost:8989/simple.svc/Submissions?%24top=3&%24wkt=true&%24count=true&%24skiptoken=01e30%3D');
            resultObj['@odata.nextLink'].should.have.skiptoken({});
            done();
          })));
      });

      it('should provide the row count if requested', (done) => {
        const query = { $count: 'true' };
        const inRows = streamTest.fromObjects(instances(8)); // make it close to check the off-by-one.
        fieldsFor(testData.forms.simple)
          .then((fields) => rowStreamToOData(fields, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions?$count=true', query, inRows))
          .then((stream) => stream.pipe(streamTest.toText((_, result) => {
            const resultObj = JSON.parse(result);
            resultObj['@odata.count'].should.equal(8);
            done();
          })));
      });

      it('should provide the full row count even if windowed', (done) => {
        const query = { $top: '1', $skip: '1', $count: 'true' };
        const inRows = streamTest.fromObjects(instances(8)); // make it close to check the off-by-one.
        fieldsFor(testData.forms.simple)
          .then((fields) => rowStreamToOData(fields, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions?$top=1&$skip=1&$count=true', query, inRows))
          .then((stream) => stream.pipe(streamTest.toText((_, result) => {
            const resultObj = JSON.parse(result);
            resultObj['@odata.count'].should.equal(8);
            done();
          })));
      });
    });

    describe('row data output', () => {
      // we only cursorily ensure that the data ends up plumbed to where it ought to be;
      // the contents themselves are more rigorously tested at test/unit/data/json
      it('should output empty row data', (done) => {
        const inRows = streamTest.fromObjects([]);
        fieldsFor(testData.forms.simple)
          .then((fields) => rowStreamToOData(fields, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions', {}, inRows))
          .then((stream) => stream.pipe(streamTest.toText((_, result) => {
            JSON.parse(result).should.eql({
              value: [],
              '@odata.context': 'http://localhost:8989/simple.svc/$metadata#Submissions',
            });
            done();
          })));
      });

      it('should output toplevel row data', (done) => {
        const inRows = streamTest.fromObjects([
          mockSubmission('one', testData.instances.simple.one),
          mockSubmission('two', testData.instances.simple.two)
        ]);
        fieldsFor(testData.forms.simple)
          .then((fields) => rowStreamToOData(fields, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions', {}, inRows))
          .then((stream) => stream.pipe(streamTest.toText((_, result) => {
            JSON.parse(result).should.eql({
              '@odata.context': 'http://localhost:8989/simple.svc/$metadata#Submissions',
              value: [
                { __id: 'one', __system, meta: { instanceID: 'one' }, name: 'Alice', age: 30 },
                { __id: 'two', __system, meta: { instanceID: 'two' }, name: 'Bob', age: 34 }
              ]
            });
            done();
          })));
      });

      it('should not limit toplevel row data (done by database)', (done) => {
        const query = { $top: 2 };
        const inRows = streamTest.fromObjects([
          mockSubmission('one', testData.instances.simple.one),
          mockSubmission('two', testData.instances.simple.two),
          mockSubmission('three', testData.instances.simple.three)
        ]);
        fieldsFor(testData.forms.simple)
          .then((fields) => rowStreamToOData(fields, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions?$top=2', query, inRows))
          .then((stream) => stream.pipe(streamTest.toText((_, result) => {
            JSON.parse(result).should.eql({
              '@odata.context': 'http://localhost:8989/simple.svc/$metadata#Submissions',
              value: [
                { __id: 'one', __system, meta: { instanceID: 'one' }, name: 'Alice', age: 30 },
                { __id: 'two', __system, meta: { instanceID: 'two' }, name: 'Bob', age: 34 },
                { __id: 'three', __system, meta: { instanceID: 'three' }, name: 'Chelsea', age: 38 }
              ]
            });
            done();
          })));
      });

      it('should not offset toplevel row data (done by database)', (done) => {
        const query = { $skip: 2 };
        const inRows = streamTest.fromObjects([
          mockSubmission('one', testData.instances.simple.one),
          mockSubmission('two', testData.instances.simple.two),
          mockSubmission('three', testData.instances.simple.three)
        ]);
        fieldsFor(testData.forms.simple)
          .then((fields) => rowStreamToOData(fields, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions?$skip=2', query, inRows))
          .then((stream) => stream.pipe(streamTest.toText((_, result) => {
            JSON.parse(result).should.eql({
              '@odata.context': 'http://localhost:8989/simple.svc/$metadata#Submissions',
              value: [
                { __id: 'one', __system, meta: { instanceID: 'one' }, name: 'Alice', age: 30 },
                { __id: 'two', __system, meta: { instanceID: 'two' }, name: 'Bob', age: 34 },
                { __id: 'three', __system, meta: { instanceID: 'three' }, name: 'Chelsea', age: 38 }
              ]
            });
            done();
          })));
      });

      it('should output subtable row data', (done) => {
        const inRows = streamTest.fromObjects([
          mockSubmission('one', testData.instances.withrepeat.one),
          mockSubmission('two', testData.instances.withrepeat.two),
          mockSubmission('three', testData.instances.withrepeat.three)
        ]);
        fieldsFor(testData.forms.withrepeat)
          .then((fields) => rowStreamToOData(fields, 'Submissions.children.child', 'http://localhost:8989', '/withrepeat.svc/Submissions', {}, inRows))
          .then((stream) => stream.pipe(streamTest.toText((_, result) => {
            JSON.parse(result).should.eql({
              '@odata.context': 'http://localhost:8989/withrepeat.svc/$metadata#Submissions.children.child',
              value: [{
                __id: 'cf9a1b5cc83c6d6270c1eb98860d294eac5d526d',
                '__Submissions-id': 'two',
                name: 'Billy',
                age: 4
              }, {
                __id: 'c76d0ccc6d5da236be7b93b985a80413d2e3e172',
                '__Submissions-id': 'two',
                name: 'Blaine',
                age: 6
              }, {
                __id: 'beaedcdba519e6e6b8037605c9ae3f6a719984fa',
                '__Submissions-id': 'three',
                name: 'Candace',
                age: 2
              }]
            });
            done();
          })));
      });

      it('should limit subtable row data', (done) => {
        const query = { $top: 2 };
        const inRows = streamTest.fromObjects([
          mockSubmission('one', testData.instances.withrepeat.one),
          mockSubmission('two', testData.instances.withrepeat.two),
          mockSubmission('three', testData.instances.withrepeat.three)
        ]);
        fieldsFor(testData.forms.withrepeat)
          .then((fields) => rowStreamToOData(fields, 'Submissions.children.child', 'http://localhost:8989', '/withrepeat.svc/Submissions.children.child?$top=2', query, inRows))
          .then((stream) => stream.pipe(streamTest.toText((_, result) => {
            const parsed = JSON.parse(result);
            parsed.should.eql({
              '@odata.context': 'http://localhost:8989/withrepeat.svc/$metadata#Submissions.children.child',
              '@odata.nextLink': 'http://localhost:8989/withrepeat.svc/Submissions.children.child?%24top=2&%24skiptoken=01eyJyZXBlYXRJZCI6ImM3NmQwY2NjNmQ1ZGEyMzZiZTdiOTNiOTg1YTgwNDEzZDJlM2UxNzIifQ%3D%3D',
              value: [{
                __id: 'cf9a1b5cc83c6d6270c1eb98860d294eac5d526d',
                '__Submissions-id': 'two',
                name: 'Billy',
                age: 4
              }, {
                __id: 'c76d0ccc6d5da236be7b93b985a80413d2e3e172',
                '__Submissions-id': 'two',
                name: 'Blaine',
                age: 6
              }]
            });
            parsed['@odata.nextLink'].should.have.skiptoken({ repeatId: 'c76d0ccc6d5da236be7b93b985a80413d2e3e172' });
            done();
          })));
      });

      it('should offset subtable row data', (done) => {
        const query = { $skip: 1 };
        const inRows = streamTest.fromObjects([
          mockSubmission('one', testData.instances.withrepeat.one),
          mockSubmission('two', testData.instances.withrepeat.two),
          mockSubmission('three', testData.instances.withrepeat.three)
        ]);
        fieldsFor(testData.forms.withrepeat)
          .then((fields) => rowStreamToOData(fields, 'Submissions.children.child', 'http://localhost:8989', '/withrepeat.svc/Submissions.children.child?$skip=2', query, inRows))
          .then((stream) => stream.pipe(streamTest.toText((_, result) => {
            JSON.parse(result).should.eql({
              '@odata.context': 'http://localhost:8989/withrepeat.svc/$metadata#Submissions.children.child',
              value: [{
                __id: 'c76d0ccc6d5da236be7b93b985a80413d2e3e172',
                '__Submissions-id': 'two',
                name: 'Blaine',
                age: 6
              }, {
                __id: 'beaedcdba519e6e6b8037605c9ae3f6a719984fa',
                '__Submissions-id': 'three',
                name: 'Candace',
                age: 2
              }]
            });
            done();
          })));
      });

      it('should limit and offset subtable row data', (done) => {
        const query = { $skip: 1, $top: 1 };
        const inRows = streamTest.fromObjects([
          mockSubmission('one', testData.instances.withrepeat.one),
          mockSubmission('two', testData.instances.withrepeat.two),
          mockSubmission('three', testData.instances.withrepeat.three)
        ]);
        fieldsFor(testData.forms.withrepeat)
          .then((fields) => rowStreamToOData(fields, 'Submissions.children.child', 'http://localhost:8989', '/withrepeat.svc/Submissions.children.child?$skip=1&$top=1', query, inRows))
          .then((stream) => stream.pipe(streamTest.toText((_, result) => {
            const parsed = JSON.parse(result);
            parsed.should.eql({
              '@odata.context': 'http://localhost:8989/withrepeat.svc/$metadata#Submissions.children.child',
              '@odata.nextLink': 'http://localhost:8989/withrepeat.svc/Submissions.children.child?%24top=1&%24skiptoken=01eyJyZXBlYXRJZCI6ImM3NmQwY2NjNmQ1ZGEyMzZiZTdiOTNiOTg1YTgwNDEzZDJlM2UxNzIifQ%3D%3D',
              value: [{
                __id: 'c76d0ccc6d5da236be7b93b985a80413d2e3e172',
                '__Submissions-id': 'two',
                name: 'Blaine',
                age: 6
              }]
            });
            parsed['@odata.nextLink'].should.have.skiptoken({ repeatId: 'c76d0ccc6d5da236be7b93b985a80413d2e3e172' });
            done();
          })));
      });

      it('should offset subtable row data by skipToken', (done) => {
        const query = { $skiptoken: QueryOptions.getSkiptoken({ instanceId: 'two', repeatId: 'cf9a1b5cc83c6d6270c1eb98860d294eac5d526d' }) };
        const inRows = streamTest.fromObjects([
          mockSubmission('one', testData.instances.withrepeat.one),
          mockSubmission('two', testData.instances.withrepeat.two),
          mockSubmission('three', testData.instances.withrepeat.three)
        ]);
        fieldsFor(testData.forms.withrepeat)
          .then((fields) => rowStreamToOData(fields, 'Submissions.children.child', 'http://localhost:8989', '/withrepeat.svc/Submissions.children.child?$skip=1&$top=1', query, inRows))
          .then((stream) => stream.pipe(streamTest.toText((_, result) => {
            JSON.parse(result).should.eql({
              '@odata.context': 'http://localhost:8989/withrepeat.svc/$metadata#Submissions.children.child',
              value: [{
                __id: 'c76d0ccc6d5da236be7b93b985a80413d2e3e172',
                '__Submissions-id': 'two',
                name: 'Blaine',
                age: 6
              }, {
                __id: 'beaedcdba519e6e6b8037605c9ae3f6a719984fa',
                '__Submissions-id': 'three',
                name: 'Candace',
                age: 2
              }]
            });
            done();
          })));
      });
    });
  });

  describe('single submission output', () => {
    describe('table verification', () => {
      // eslint-disable-next-line arrow-body-style
      it('should reject with not found if the toplevel table is wrong', () => {
        return fieldsFor(testData.forms.simple).then((fields) => {
          const submission = mockSubmission('one', testData.instances.simple.one);
          return singleRowToOData(fields, submission, 'http://localhost:8989', "/simple.svc/Nonexistent('one')", {});
        }).should.be.rejected();
      });

      // eslint-disable-next-line arrow-body-style
      it('should reject with not found if a subtable is wrong', () => {
        return fieldsFor(testData.forms.withrepeat).then((fields) => {
          const submission = mockSubmission('one', testData.instances.withrepeat.one);
          return singleRowToOData(fields, submission, 'http://localhost:8989', "/withrepeat.svc/Submissions('one')/children/child/nonexistent", {});
        }).should.be.rejected();
      });

      // eslint-disable-next-line arrow-body-style
      it('should pass if the toplevel table is correct', () => {
        return fieldsFor(testData.forms.simple).then((fields) => {
          const submission = mockSubmission('one', testData.instances.simple.one);
          return singleRowToOData(fields, submission, 'http://localhost:8989', "/simple.svc/Submissions('one')", {})
            .should.not.be.rejected();
        });
      });

      // eslint-disable-next-line arrow-body-style
      it('should pass if the subtable is correct', () => {
        return fieldsFor(testData.forms.withrepeat).then((fields) => {
          const submission = mockSubmission('one', testData.instances.withrepeat.one);
          return singleRowToOData(fields, submission, 'http://localhost:8989', "/withrepeat.svc/Submissions('one')/children/child", {})
            .should.not.be.rejected();
        });
      });
    });

    describe('metadata generation', () => {
      // eslint-disable-next-line arrow-body-style
      it('should provide the correct context url for the toplevel table', () => {
        return fieldsFor(testData.forms.simple).then((fields) => {
          const submission = mockSubmission('one', testData.instances.simple.one);
          return singleRowToOData(fields, submission, 'http://localhost:8989', "/simple.svc/Submissions('one')", {})
            .then(JSON.parse)
            .then((result) => {
              result['@odata.context'].should.equal('http://localhost:8989/simple.svc/$metadata#Submissions');
            });
        });
      });

      // eslint-disable-next-line arrow-body-style
      it('should provide the correct context url for a subtable', () => {
        return fieldsFor(testData.forms.withrepeat).then((fields) => {
          const submission = mockSubmission('one', testData.instances.withrepeat.one);
          return singleRowToOData(fields, submission, 'http://localhost:8989', "/withrepeat.svc/Submissions('one')/children/child", {})
            .then(JSON.parse)
            .then((result) => {
              result['@odata.context'].should.equal('http://localhost:8989/withrepeat.svc/$metadata#Submissions.children.child');
            });
        });
      });

      // eslint-disable-next-line arrow-body-style
      it('should provide no nextUrl if the final row is accounted for', () => {
        return fieldsFor(testData.forms.withrepeat).then((fields) => {
          const submission = mockSubmission('two', testData.instances.withrepeat.two);
          return singleRowToOData(fields, submission, 'http://localhost:8989', "/withrepeat.svc/Submissions('two')/children/child", {})
            .then(JSON.parse)
            .then((result) => {
              // eslint-disable-next-line no-undef
              should.not.exist(result['@odata.nextLink']);
            });
        });
      });

      // eslint-disable-next-line arrow-body-style
      it('should provide the correct nextUrl if rows remain', () => {
        return fieldsFor(testData.forms.withrepeat).then((fields) => {
          const submission = mockSubmission('two', testData.instances.withrepeat.two);
          const query = { $top: 1 };
          return singleRowToOData(fields, submission, 'http://localhost:8989', "/withrepeat.svc/Submissions('two')/children/child?$top=1", query)
            .then(JSON.parse)
            .then((result) => {
              result['@odata.nextLink'].should.equal("http://localhost:8989/withrepeat.svc/Submissions('two')/children/child?%24top=1&%24skiptoken=01eyJyZXBlYXRJZCI6ImNmOWExYjVjYzgzYzZkNjI3MGMxZWI5ODg2MGQyOTRlYWM1ZDUyNmQifQ%3D%3D");
            });
        });
      });

      describe('with $skiptoken', () => {
        const billy = { __id: 'cf9a1b5cc83c6d6270c1eb98860d294eac5d526d', age: 4, name: 'Billy' };
        const blain = { __id: 'c76d0ccc6d5da236be7b93b985a80413d2e3e172', age: 6, name: 'Blaine' };

        const nomatch = '0000000000000000000000000000000000000000';

        [
          {
            $top: 0,
            skiptoken: { repeatId: nomatch },
          },
          {
            $top: 1,
            skiptoken: { repeatId: nomatch },
          },
          {
            $top: 2,
            skiptoken: { repeatId: nomatch },
          },
          {
            $top: undefined,
            skiptoken: { repeatId: nomatch },
          },
        ].forEach(({ $top, skiptoken }) =>
          it(`should throw error for ${[$top, JSON.stringify(skiptoken)]}`, () =>
            fieldsFor(testData.forms.withrepeat)
              .then((fields) => {
                const submission = mockSubmission('two', testData.instances.withrepeat.two);
                const $skiptoken = '01' + Buffer.from(JSON.stringify(skiptoken)).toString('base64');
                const query = { $top, $skiptoken };
                const originaUrl = "/withrepeat.svc/Submissions('two')/children/child"; // doesn't have to include query string
                return singleRowToOData(fields, submission, 'http://localhost:8989', originaUrl, query);
              })
              .should.be.rejectedWith(Problem, { problemCode: 400.34, message: 'Record associated with the provided $skiptoken not found.' })));

        [
          {
            $top: 0,
            skiptoken: { repeatId: billy.__id },
            expectedNext: false,
            expectedValue: [],
          },
          {
            $top: 1,
            skiptoken: { repeatId: billy.__id },
            expectedNext: false,
            expectedValue: [ blain ],
          },
          {
            $top: 2,
            skiptoken: { repeatId: billy.__id },
            expectedNext: false,
            expectedValue: [ blain ],
          },
          {
            $top: undefined,
            skiptoken: { repeatId: billy.__id },
            expectedNext: false,
            expectedValue: [ blain ],
          },

          {
            $top: 0,
            skiptoken: { repeatId: blain.__id },
            expectedNext: false,
            expectedValue: [],
          },
          {
            $top: 1,
            skiptoken: { repeatId: blain.__id },
            expectedNext: false,
            expectedValue: [],
          },
          {
            $top: 2,
            skiptoken: { repeatId: blain.__id },
            expectedNext: false,
            expectedValue: [],
          },
          {
            $top: undefined,
            skiptoken: { repeatId: blain.__id },
            expectedNext: false,
            expectedValue: [],
          },
        ].forEach(({ $top, skiptoken, expectedNext, expectedValue }) =>
          it(`should return expected result for ${[$top, JSON.stringify(skiptoken)]}`, () =>
            fieldsFor(testData.forms.withrepeat).then((fields) => {
              const submission = mockSubmission('two', testData.instances.withrepeat.two);
              const $skiptoken = '01' + Buffer.from(JSON.stringify(skiptoken)).toString('base64');
              const query = { $top, $skiptoken };
              const originaUrl = "/withrepeat.svc/Submissions('two')/children/child"; // doesn't have to include query string
              return singleRowToOData(fields, submission, 'http://localhost:8989', originaUrl, query)
                .then(JSON.parse)
                .then((res) => {
                  res['@odata.context'].should.eql('http://localhost:8989/withrepeat.svc/$metadata#Submissions.children.child');

                  const nextLink = res['@odata.nextLink'];
                  if (expectedNext === false) should(nextLink).be.undefined();
                  else {
                    should(nextLink).be.ok();
                    JSON.parse(
                      Buffer.from(
                        new URL(nextLink)
                          .searchParams
                          .get('$skiptoken')
                          .substr(2),
                        'base64',
                      ).toString()
                    ).should.deepEqual({ repeatId: expectedNext });
                  }

                  res.value.should.deepEqual(expectedValue.map(x => ({ ...x, '__Submissions-id': 'two' })));
                });
            })));
      });

      // eslint-disable-next-line arrow-body-style
      it('should retain other parameters when giving the nextUrl', () => {
        return fieldsFor(testData.forms.withrepeat).then((fields) => {
          const submission = mockSubmission('two', testData.instances.withrepeat.two);
          const query = { $top: 1, $wkt: 'true' };
          return singleRowToOData(fields, submission, 'http://localhost:8989', "/withrepeat.svc/Submissions('two')/children/child?$top=1&$wkt=true", query)
            .then(JSON.parse)
            .then((result) => {
              result['@odata.nextLink'].should.equal("http://localhost:8989/withrepeat.svc/Submissions('two')/children/child?%24top=1&%24wkt=true&%24skiptoken=01eyJyZXBlYXRJZCI6ImNmOWExYjVjYzgzYzZkNjI3MGMxZWI5ODg2MGQyOTRlYWM1ZDUyNmQifQ%3D%3D");
              result['@odata.nextLink'].should.have.skiptoken({ repeatId: 'cf9a1b5cc83c6d6270c1eb98860d294eac5d526d' });
            });
        });
      });

      // eslint-disable-next-line arrow-body-style
      it('should provide the row count if requested', () => {
        return fieldsFor(testData.forms.withrepeat).then((fields) => {
          const submission = mockSubmission('two', testData.instances.withrepeat.two);
          const query = { $count: 'true' };
          return singleRowToOData(fields, submission, 'http://localhost:8989', "/withrepeat.svc/Submissions('two')/children/child?$count=true", query)
            .then(JSON.parse)
            .then((result) => {
              result['@odata.count'].should.equal(2);
            });
        });
      });

      // eslint-disable-next-line arrow-body-style
      it('should provide the full row count even if windowed', () => {
        return fieldsFor(testData.forms.withrepeat).then((fields) => {
          const submission = mockSubmission('two', testData.instances.withrepeat.two);
          const query = { $top: '1', $count: 'true' };
          return singleRowToOData(fields, submission, 'http://localhost:8989', "/withrepeat.svc/Submissions('two')/children/child?$top=1$count=true", query)
            .then(JSON.parse)
            .then((result) => {
              result['@odata.count'].should.equal(2);
            });
        });
      });
    });

    describe('row data output', () => {
      // eslint-disable-next-line arrow-body-style
      it('should output single instance data', () => {
        return fieldsFor(testData.forms.doubleRepeat).then((fields) => {
          const submission = mockSubmission('double', testData.instances.doubleRepeat.double);
          return singleRowToOData(fields, submission, 'http://localhost:8989', "/doubleRepeat.svc/Submissions('double')", {})
            .then(JSON.parse)
            .then((result) => {
              result.should.eql({
                '@odata.context': 'http://localhost:8989/doubleRepeat.svc/$metadata#Submissions',
                value: [{
                  __id: 'double',
                  __system,
                  meta: { instanceID: 'double' },
                  name: 'Vick',
                  children: {
                    'child@odata.navigationLink': "Submissions('double')/children/child"
                  }
                }]
              });
            });
        });
      });

      // eslint-disable-next-line arrow-body-style
      it('should filter to a single subinstance', () => {
        return fieldsFor(testData.forms.doubleRepeat).then((fields) => {
          const submission = mockSubmission('double', testData.instances.doubleRepeat.double);
          return singleRowToOData(fields, submission, 'http://localhost:8989', "/doubleRepeat.svc/Submissions('double')/children/child('b6e93a81a53eed0566e65e472d4a4b9ae383ee6d')/toys/toy", {})
            .then(JSON.parse)
            .then((result) => {
              result.should.eql({
                '@odata.context': 'http://localhost:8989/doubleRepeat.svc/$metadata#Submissions.children.child.toys.toy',
                value: [{
                  __id: 'a9058d7b2ed9557205ae53f5b1dc4224043eca2a',
                  '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
                  name: 'Twilight Sparkle'
                }, {
                  __id: '8d2dc7bd3e97a690c0813e646658e51038eb4144',
                  '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
                  name: 'Pinkie Pie'
                }, {
                  __id: 'b716dd8b79a4c9369d6b1e7a9c9d55ac18da1319',
                  '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
                  name: 'Applejack'
                }, {
                  __id: '52fbd613acc151ee1187026890f6246b35f69144',
                  '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
                  name: 'Spike'
                }]
              });
            });
        });
      });

      // eslint-disable-next-line arrow-body-style
      it('should limit subtable data', () => {
        return fieldsFor(testData.forms.doubleRepeat).then((fields) => {
          const submission = mockSubmission('double', testData.instances.doubleRepeat.double);
          const query = { $top: '2' };
          return singleRowToOData(fields, submission, 'http://localhost:8989', "/doubleRepeat.svc/Submissions('double')/children/child('b6e93a81a53eed0566e65e472d4a4b9ae383ee6d')/toys/toy?$top=2", query)
            .then(JSON.parse)
            .then((result) => {
              result.should.eql({
                '@odata.context': 'http://localhost:8989/doubleRepeat.svc/$metadata#Submissions.children.child.toys.toy',
                '@odata.nextLink': "http://localhost:8989/doubleRepeat.svc/Submissions('double')/children/child('b6e93a81a53eed0566e65e472d4a4b9ae383ee6d')/toys/toy?%24top=2&%24skiptoken=01eyJyZXBlYXRJZCI6IjhkMmRjN2JkM2U5N2E2OTBjMDgxM2U2NDY2NThlNTEwMzhlYjQxNDQifQ%3D%3D",
                value: [{
                  __id: 'a9058d7b2ed9557205ae53f5b1dc4224043eca2a',
                  '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
                  name: 'Twilight Sparkle'
                }, {
                  __id: '8d2dc7bd3e97a690c0813e646658e51038eb4144',
                  '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
                  name: 'Pinkie Pie'
                }]
              });
            });
        });
      });

      // eslint-disable-next-line arrow-body-style
      it('should offset subtable data', () => {
        return fieldsFor(testData.forms.doubleRepeat).then((fields) => {
          const submission = mockSubmission('double', testData.instances.doubleRepeat.double);
          const query = { $skip: '1' };
          return singleRowToOData(fields, submission, 'http://localhost:8989', "/doubleRepeat.svc/Submissions('double')/children/child('b6e93a81a53eed0566e65e472d4a4b9ae383ee6d')/toys/toy?$skip=1", query)
            .then(JSON.parse)
            .then((result) => {
              result.should.eql({
                '@odata.context': 'http://localhost:8989/doubleRepeat.svc/$metadata#Submissions.children.child.toys.toy',
                value: [{
                  __id: '8d2dc7bd3e97a690c0813e646658e51038eb4144',
                  '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
                  name: 'Pinkie Pie'
                }, {
                  __id: 'b716dd8b79a4c9369d6b1e7a9c9d55ac18da1319',
                  '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
                  name: 'Applejack'
                }, {
                  __id: '52fbd613acc151ee1187026890f6246b35f69144',
                  '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
                  name: 'Spike'
                }]
              });
            });
        });
      });

      // eslint-disable-next-line arrow-body-style
      it('should limit and offset subtable data', () => {
        return fieldsFor(testData.forms.doubleRepeat).then((fields) => {
          const submission = mockSubmission('double', testData.instances.doubleRepeat.double);
          const query = { $skip: '1', $top: '2' };
          return singleRowToOData(fields, submission, 'http://localhost:8989', "/doubleRepeat.svc/Submissions('double')/children/child('b6e93a81a53eed0566e65e472d4a4b9ae383ee6d')/toys/toy?$skip=1&$top=2", query)
            .then(JSON.parse)
            .then((result) => {
              result.should.eql({
                '@odata.context': 'http://localhost:8989/doubleRepeat.svc/$metadata#Submissions.children.child.toys.toy',
                '@odata.nextLink': "http://localhost:8989/doubleRepeat.svc/Submissions('double')/children/child('b6e93a81a53eed0566e65e472d4a4b9ae383ee6d')/toys/toy?%24top=2&%24skiptoken=01eyJyZXBlYXRJZCI6ImI3MTZkZDhiNzlhNGM5MzY5ZDZiMWU3YTljOWQ1NWFjMThkYTEzMTkifQ%3D%3D",
                value: [{
                  __id: '8d2dc7bd3e97a690c0813e646658e51038eb4144',
                  '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
                  name: 'Pinkie Pie'
                }, {
                  __id: 'b716dd8b79a4c9369d6b1e7a9c9d55ac18da1319',
                  '__Submissions-children-child-id': 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
                  name: 'Applejack'
                }]
              });
            });
        });
      });

    });
  });

  describe('select fields', () => {
    it('should return all fields if $select not provided', () => fieldsFor(testData.forms.simple)
      .then((fields) => selectFields({}, 'Submissions')(fields).length.should.equal(fields.length)));

    it('should return only selected fields', () => fieldsFor(testData.forms.simple)
      .then(selectFields({ $select: 'name,age,meta/instanceID' }, 'Submissions'))
      .then((filteredFields) => {
        filteredFields.length.should.equal(4);
      }));

    it('should throw property not found error', () => fieldsFor(testData.forms.simple)
      .then((fields) => {
        (() => selectFields({ $select: 'address' }, 'Submissions')(fields)).should.throw('Could not find a property named \'address\'');
      }));

    it('should not throw error if __id is requested for non-submissions table', () => fieldsFor(testData.forms.withrepeat)
      .then((fields) => {
        (() => selectFields({ $select: '__id' }, 'Submissions.children')(fields)).should.not.throw();
      }));

    it('should not throw error if system properties are requested for submissions table', () => fieldsFor(testData.forms.simple)
      .then((fields) => {
        (() => selectFields({ $select: '__id, __system/status' }, 'Submissions')(fields)).should.not.throw();
      }));

    it('should throw error if system properties are requested for non-submissions table', () => fieldsFor(testData.forms.withrepeat)
      .then((fields) => {
        (() => selectFields({ $select: '__id, __system/status' }, 'Submissions.children')(fields)).should.throw('Could not find a property named \'__system/status\'');
      }));

    it('should throw error if unknown system property is requested', () => fieldsFor(testData.forms.simple)
      .then((fields) => {
        (() => selectFields({ $select: '__system/etag' }, 'Submissions')(fields)).should.throw('Could not find a property named \'__system/etag\'');
      }));

    it('should throw error if property of repeat is requested', () => fieldsFor(testData.forms.doubleRepeat)
      .then((fields) => {
        (() => selectFields({ $select: 'children/child/name' }, 'Submissions')(fields)).should.throw('The given OData select property \'children/child/name\' uses features not supported by this server.');
      }));

    it('should be able to select sanitized fields', () => {
      const fields = [
        new MockField({ path: '/$meta', name: '$meta', type: 'structure' }),
        new MockField({ path: '/$meta/$miles', name: '$miles', type: 'decimal' }),
        new MockField({ path: '/1car', name: '1car', type: 'string' })
      ];
      selectFields({ $select: '_1car,__meta/__miles' }, 'Submissions')(fields).length.should.equal(3);
    });

    it('should be able to select properties of subtable', () => fieldsFor(testData.forms.doubleRepeat)
      .then(selectFields({ $select: 'name' }, 'Submissions.children.child'))
      .then((filteredFields) => {
        filteredFields.length.should.equal(3);
      }));

    it('should select group field as well if child field is requested', () => fieldsFor(testData.forms.simple)
      .then(selectFields({ $select: 'meta/instanceID' }, 'Submissions'))
      .then((filteredFields) => {
        filteredFields.length.should.equal(2);
      }));
  });

  describe('getFieldTree', () => {
    it('should make the tree', () => {
      const fields = [
        new MockField({ path: '/home', name: 'home', type: 'structure' }),
        new MockField({ path: '/home/address', name: 'address', type: 'structure' }),
        new MockField({ path: '/home/address/country', name: 'country', type: 'text' }),
        new MockField({ path: '/home/address/province', name: 'province', type: 'text' }),
        new MockField({ path: '/home/address/city', name: 'city', type: 'text' })
      ];

      const tree = getFieldTree(fields);
      should(tree['/home'].parent).be.null();
      tree['/home'].children.map(c => c.value.name).should.be.eql(['address']);

      tree['/home/address'].parent.value.name.should.be.eql('home');
      tree['/home/address'].children.map(c => c.value.name).should.be.eql(['country', 'province', 'city']);

      tree['/home/address/country'].parent.value.name.should.be.eql('address');
      tree['/home/address/country'].children.should.be.eql([]);

      tree['/home/address/province'].parent.value.name.should.be.eql('address');
      tree['/home/address/province'].children.should.be.eql([]);

      tree['/home/address/city'].parent.value.name.should.be.eql('address');
      tree['/home/address/city'].children.should.be.eql([]);
    });
  });

  describe('getChildren', () => {
    it('should return all children recursively', () => {
      const fields = [
        new MockField({ path: '/home', name: 'home', type: 'structure' }),
        new MockField({ path: '/home/address', name: 'address', type: 'structure' }),
        new MockField({ path: '/home/address/country', name: 'country', type: 'text' }),
        new MockField({ path: '/home/address/province', name: 'province', type: 'text' }),
        new MockField({ path: '/home/address/city', name: 'city', type: 'text' })
      ];

      const tree = getFieldTree(fields);

      const children = getChildren(tree['/home']);

      Array.from(children.values()).map(c => c.name).should.be.eql(['address', 'country', 'province', 'city']);
    });
  });

});

