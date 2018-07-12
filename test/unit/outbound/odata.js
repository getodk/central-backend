const appRoot = require('app-root-path');
const streamTest = require('streamtest').v2;
const { identity } = require('ramda');
const { getFormSchema } = require(appRoot + '/lib/data/schema');
const { serviceDocumentFor, edmxFor, rowStreamToOData, singleRowToOData } = require(appRoot + '/lib/outbound/odata');
const testData = require(appRoot + '/test/integration/data');

// Helpers to deal with repeated system metadata generation.
const submitter = { id: 5, displayName: 'Alice' };
const __system = {
  submissionDate: '2017-09-20T17:10:43Z',
  submitterId: submitter.id.toString(),
  submitterName: submitter.displayName
};
const mockSubmission = (instanceId, xml) => ({
  instanceId,
  submitter,
  xml,
  createdAt: __system.submissionDate
});

describe('odata message composition', () => {
  describe('service document', () => {
    it('should return the correct metadata context', () => {
      serviceDocumentFor({ tables: () => [] }, 'http://localhost:8989', '/forms/testform.svc')['@odata.context']
        .should.equal('http://localhost:8989/forms/testform.svc/$metadata');
    });

    it('should return the root table in all cases', () => {
      serviceDocumentFor({ tables: () => [] }, 'http://localhost:8989', '/forms/simple.svc').should.eql({
        '@odata.context': 'http://localhost:8989/forms/simple.svc/$metadata',
        value: [{ name: 'Submissions', kind: 'EntitySet', url: 'Submissions' }]
      });
    });

    it('should return all nested tables in addition to the root table', () => {
      const tables = [ 'children.child', 'children.child.toys.toy' ];
      serviceDocumentFor({ tables: () => tables }, 'http://localhost:8989', '/forms/doubleRepeat.svc').should.eql({
        '@odata.context': 'http://localhost:8989/forms/doubleRepeat.svc/$metadata',
        value: [
          { name: 'Submissions', kind: 'EntitySet', url: 'Submissions' },
          { name: 'Submissions.children.child', kind: 'EntitySet', url: 'Submissions.children.child' },
          { name: 'Submissions.children.child.toys.toy', kind: 'EntitySet', url: 'Submissions.children.child.toys.toy' }
        ]
      });
    });
  });

  describe('metadata document', () => {
    // there is a LOT of content in our EDMX output because of our Capabilities declarations.
    // we don't try to test all of that comprehensively, we focus mostly on basic correctness
    // and the few branch cases there are.

    it('should return a basic metadata document', () => {
      const form = { xmlFormId: 'simple', schema: () => getFormSchema({ xml: testData.forms.simple }) };
      edmxFor(form).should.startWith(`<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.user.simple">
      <EntityType Name="Submissions">
        <Key><PropertyRef Name="__id"/></Key>
        <Property Name="__id" Type="Edm.String"/>
        <Property Name="__system" Type="org.opendatakit.user.simple.__system"/>
        <Property Name="meta" Type="org.opendatakit.user.simple.meta"/>
        <Property Name="name" Type="Edm.String"/>
        <Property Name="age" Type="Edm.Int64"/>
      </EntityType>
      <ComplexType Name="__system">
        <Property Name="submissionDate" Type="Edm.DateTimeOffset"/>
        <Property Name="submitterId" Type="Edm.String"/>
        <Property Name="submitterName" Type="Edm.String"/>
      </ComplexType>
      <ComplexType Name="meta">
        <Property Name="instanceID" Type="Edm.String"/>
      </ComplexType>
      <EntityContainer Name="simple">
        <EntitySet Name="Submissions" EntityType="org.opendatakit.user.simple.Submissions">`);
    });

    /* TODO: commented out pending resolution of issue ticket #82:
    it('should express repeats as entity types behind navigation properties', () => {
      const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
      const edmx = edmxFor(form)
      edmx.should.startWith(`<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.user.withrepeat">
      <EntityType Name="Submissions">
        <Key><PropertyRef Name="__id"/></Key>
        <Property Name="__id" Type="Edm.String"/>
        <Property Name="__system" Type="org.opendatakit.user.withrepeat.__system"/>
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
      <ComplexType Name="__system">
        <Property Name="submissionDate" Type="Edm.DateTimeOffset"/>
        <Property Name="submitterId" Type="Edm.String"/>
        <Property Name="submitterName" Type="Edm.String"/>
      </ComplexType>
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
    });*/

    // TODO: remove the following test following resolution of issue ticket #82:
    it('should ignore repeats in schema output', () => {
      const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
      const edmx = edmxFor(form)
      edmx.should.startWith(`<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.user.withrepeat">
      <EntityType Name="Submissions">
        <Key><PropertyRef Name="__id"/></Key>
        <Property Name="__id" Type="Edm.String"/>
        <Property Name="__system" Type="org.opendatakit.user.withrepeat.__system"/>
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
      <ComplexType Name="__system">
        <Property Name="submissionDate" Type="Edm.DateTimeOffset"/>
        <Property Name="submitterId" Type="Edm.String"/>
        <Property Name="submitterName" Type="Edm.String"/>
      </ComplexType>
      <ComplexType Name="meta">
        <Property Name="instanceID" Type="Edm.String"/>
      </ComplexType>
      <ComplexType Name="children">
      </ComplexType>
      <EntityContainer Name="withrepeat">
        <EntitySet Name="Submissions" EntityType="org.opendatakit.user.withrepeat.Submissions">`);
    });

    it('should express repeats as entitysets', () => {
      const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
      const edmx = edmxFor(form)
      edmx.should.endWith(`<EntitySet Name="Submissions.children.child" EntityType="org.opendatakit.user.withrepeat.Submissions.children.child">
        </EntitySet>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`);
    });

    it('should appropriately name repeat-parent join ids', () => {
      const form = { xmlFormId: 'double', schema: () => getFormSchema({ xml: testData.forms.doubleRepeat }) };
      edmxFor(form).includes(`<EntityType Name="Submissions.children.child.toys.toy">
        <Key><PropertyRef Name="__id"/></Key>
        <Property Name="__id" Type="Edm.String"/>
        <Property Name="__Submissions-children-child-id" Type="Edm.String"/>`).should.equal(true);
    });
  });

  describe('rowstream conversion', () => {
    describe('table verification', () => {
      it('should reject with not found if the toplevel table is wrong', () => {
        const form = { xmlFormId: 'simple', schema: () => getFormSchema({ xml: testData.forms.simple }) };
        const inRows = streamTest.fromObjects([]);
        should.throws(() => {
          rowStreamToOData(form, 'Dummy', 'http://localhost:8989', '/simple.svc', {}, inRows, 0).pipe(streamTest.toText(identity))
        });
      });

      it('should reject with not found if a subtable is wrong', () => {
        const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
        const inRows = streamTest.fromObjects([]);
        should.throws(() => {
          rowStreamToOData(form, 'Submissions.nonexistent', 'http://localhost:8989', '/withrepeat.svc', {}, inRows, 0).pipe(streamTest.toText(identity))
        });
      });

      it('should pass if the toplevel table is correct', () => {
        const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
        const inRows = streamTest.fromObjects([]);
        should.doesNotThrow(() => {
          rowStreamToOData(form, 'Submissions', 'http://localhost:8989', '/withrepeat.svc', {}, inRows, 0).pipe(streamTest.toText(identity))
        });
      });

      it('should pass if the subtable is correct', () => {
        const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
        const inRows = streamTest.fromObjects([]);
        should.doesNotThrow(() => {
          rowStreamToOData(form, 'Submissions.children.child', 'http://localhost:8989', '/withrepeat.svc', {}, inRows, 0).pipe(streamTest.toText(identity))
        });
      });
    });

    describe('metadata generation', () => {
      it('should provide the correct context url for the toplevel table', (done) => {
        const form = { xmlFormId: 'simple', schema: () => getFormSchema({ xml: testData.forms.simple }) };
        const inRows = streamTest.fromObjects([]);
        rowStreamToOData(form, 'Submissions', 'http://localhost:8989', '/simple.svc', {}, inRows).pipe(streamTest.toText((_, result) => {
          const resultObj = JSON.parse(result);
          resultObj['@odata.context'].should.equal('http://localhost:8989/simple.svc/$metadata#Submissions');
          done();
        }));
      });

      it('should provide the correct context url for a subtable', (done) => {
        const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
        const inRows = streamTest.fromObjects([]);
        rowStreamToOData(form, 'Submissions.children.child', 'http://localhost:8989', '/withrepeat.svc', {}, inRows).pipe(streamTest.toText((_, result) => {
          const resultObj = JSON.parse(result);
          resultObj['@odata.context'].should.equal('http://localhost:8989/withrepeat.svc/$metadata#Submissions.children.child');
          done();
        }));
      });

      const instances = (count) => (new Array(count)).fill({ submitter, xml: '<data/>' });
      it('should provide no nextUrl if the final row is accounted for', (done) => {
        const form = { xmlFormId: 'simple', schema: () => getFormSchema({ xml: testData.forms.simple }) };
        const query = { $top: '3', $skip: '7' };
        const inRows = streamTest.fromObjects(instances(10));
        rowStreamToOData(form, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions?$top=3&$skip=7', query, inRows).pipe(streamTest.toText((_, result) => {
          const resultObj = JSON.parse(result);
          should.not.exist(resultObj['@odata.nextLink']);
          done();
        }));
      });

      it('should provide the correct nextUrl if rows remain', (done) => {
        const form = { xmlFormId: 'simple', schema: () => getFormSchema({ xml: testData.forms.simple }) };
        const query = { $top: '3', $skip: '2' };
        const inRows = streamTest.fromObjects(instances(6)); // make it close to check the off-by-one.
        rowStreamToOData(form, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions?$top=3&$skip=2', query, inRows).pipe(streamTest.toText((_, result) => {
          const resultObj = JSON.parse(result);
          resultObj['@odata.nextLink'].should.equal('http://localhost:8989/simple.svc/Submissions?%24skip=5');
          done();
        }));
      });

      it('should retain other parameters when giving the nextUrl', (done) => {
        const form = { xmlFormId: 'simple', schema: () => getFormSchema({ xml: testData.forms.simple }) };
        const query = { $top: '3', $skip: '2', $wkt: 'true', $count: 'true' };
        const inRows = streamTest.fromObjects(instances(6)); // make it close to check the off-by-one.
        rowStreamToOData(form, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions?$top=3&$skip=2&$wkt=true&$count=true', query, inRows).pipe(streamTest.toText((_, result) => {
          const resultObj = JSON.parse(result);
          resultObj['@odata.nextLink'].should.equal('http://localhost:8989/simple.svc/Submissions?%24skip=5&%24wkt=true&%24count=true');
          done();
        }));
      });

      it('should provide the row count if requested', (done) => {
        const form = { xmlFormId: 'simple', schema: () => getFormSchema({ xml: testData.forms.simple }) };
        const query = { $count: 'true' };
        const inRows = streamTest.fromObjects(instances(8)); // make it close to check the off-by-one.
        rowStreamToOData(form, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions?$count=true', query, inRows).pipe(streamTest.toText((_, result) => {
          const resultObj = JSON.parse(result);
          resultObj['@odata.count'].should.equal(8);
          done();
        }));
      });

      it('should provide the full row count even if windowed', (done) => {
        const form = { xmlFormId: 'simple', schema: () => getFormSchema({ xml: testData.forms.simple }) };
        const query = { $top: '1', $skip: '1', $count: 'true' };
        const inRows = streamTest.fromObjects(instances(8)); // make it close to check the off-by-one.
        rowStreamToOData(form, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions?$top=1&$skip=1&$count=true', query, inRows).pipe(streamTest.toText((_, result) => {
          const resultObj = JSON.parse(result);
          resultObj['@odata.count'].should.equal(8);
          done();
        }));
      });
    });

    describe('row data output', () => {
      // we only cursorily ensure that the data ends up plumbed to where it ought to be;
      // the contents themselves are more rigorously tested at test/unit/data/json
      it('should output empty row data', (done) => {
        const form = { xmlFormId: 'simple', schema: () => getFormSchema({ xml: testData.forms.simple }) };
        const inRows = streamTest.fromObjects([]);
        rowStreamToOData(form, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions', {}, inRows).pipe(streamTest.toText((_, result) => {
          JSON.parse(result).should.eql({
            '@odata.context': 'http://localhost:8989/simple.svc/$metadata#Submissions',
          });
          done();
        }));
      });

      it('should output toplevel row data', (done) => {
        const form = { xmlFormId: 'simple', schema: () => getFormSchema({ xml: testData.forms.simple }) };
        const inRows = streamTest.fromObjects([
          mockSubmission('one', testData.instances.simple.one),
          mockSubmission('two', testData.instances.simple.two)
        ]);
        rowStreamToOData(form, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions', {}, inRows).pipe(streamTest.toText((_, result) => {
          JSON.parse(result).should.eql({
            '@odata.context': 'http://localhost:8989/simple.svc/$metadata#Submissions',
            value: [
              { __id: 'one', __system, meta: { instanceID: 'one' }, name: 'Alice', age: 30 },
              { __id: 'two', __system, meta: { instanceID: 'two' }, name: 'Bob', age: 34 }
            ]
          });
          done();
        }));
      });

      it('should limit toplevel row data', (done) => {
        const form = { xmlFormId: 'simple', schema: () => getFormSchema({ xml: testData.forms.simple }) };
        const query = { $top: 2 };
        const inRows = streamTest.fromObjects([
          mockSubmission('one', testData.instances.simple.one),
          mockSubmission('two', testData.instances.simple.two),
          mockSubmission('three', testData.instances.simple.three)
        ]);
        rowStreamToOData(form, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions?$top=2', query, inRows).pipe(streamTest.toText((_, result) => {
          JSON.parse(result).should.eql({
            '@odata.context': 'http://localhost:8989/simple.svc/$metadata#Submissions',
            '@odata.nextLink': 'http://localhost:8989/simple.svc/Submissions?%24skip=2',
            value: [
              { __id: 'one', __system, meta: { instanceID: 'one' }, name: 'Alice', age: 30 },
              { __id: 'two', __system, meta: { instanceID: 'two' }, name: 'Bob', age: 34 }
            ]
          });
          done();
        }));
      });

      it('should offset toplevel row data', (done) => {
        const form = { xmlFormId: 'simple', schema: () => getFormSchema({ xml: testData.forms.simple }) };
        const query = { $skip: 2 };
        const inRows = streamTest.fromObjects([
          mockSubmission('one', testData.instances.simple.one),
          mockSubmission('two', testData.instances.simple.two),
          mockSubmission('three', testData.instances.simple.three)
        ]);
        rowStreamToOData(form, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions?$skip=2', query, inRows).pipe(streamTest.toText((_, result) => {
          JSON.parse(result).should.eql({
            '@odata.context': 'http://localhost:8989/simple.svc/$metadata#Submissions',
            value: [
              { __id: 'three', __system, meta: { instanceID: 'three' }, name: 'Chelsea', age: 38 }
            ]
          });
          done();
        }));
      });

      it('should limit and offset toplevel row data', (done) => {
        const form = { xmlFormId: 'simple', schema: () => getFormSchema({ xml: testData.forms.simple }) };
        const query = { $top: 1, $skip: 1 };
        const inRows = streamTest.fromObjects([
          mockSubmission('one', testData.instances.simple.one),
          mockSubmission('two', testData.instances.simple.two),
          mockSubmission('three', testData.instances.simple.three)
        ]);
        rowStreamToOData(form, 'Submissions', 'http://localhost:8989', '/simple.svc/Submissions?$top=1&$skip=1', query, inRows).pipe(streamTest.toText((_, result) => {
          JSON.parse(result).should.eql({
            '@odata.context': 'http://localhost:8989/simple.svc/$metadata#Submissions',
            '@odata.nextLink': 'http://localhost:8989/simple.svc/Submissions?%24skip=2',
            value: [
              { __id: 'two', __system, meta: { instanceID: 'two' }, name: 'Bob', age: 34 }
            ]
          });
          done();
        }));
      });

      it('should output subtable row data', (done) => {
        const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
        const inRows = streamTest.fromObjects([
          mockSubmission('one', testData.instances.withrepeat.one),
          mockSubmission('two', testData.instances.withrepeat.two),
          mockSubmission('three', testData.instances.withrepeat.three)
        ]);
        rowStreamToOData(form, 'Submissions.children.child', 'http://localhost:8989', '/withrepeat.svc/Submissions', {}, inRows).pipe(streamTest.toText((_, result) => {
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
        }));
      });

      it('should limit subtable row data', (done) => {
        const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
        const query = { $top: 2 };
        const inRows = streamTest.fromObjects([
          mockSubmission('one', testData.instances.withrepeat.one),
          mockSubmission('two', testData.instances.withrepeat.two),
          mockSubmission('three', testData.instances.withrepeat.three)
        ]);
        rowStreamToOData(form, 'Submissions.children.child', 'http://localhost:8989', '/withrepeat.svc/Submissions.children.child?$top=2', query, inRows).pipe(streamTest.toText((_, result) => {
          JSON.parse(result).should.eql({
            '@odata.context': 'http://localhost:8989/withrepeat.svc/$metadata#Submissions.children.child',
            '@odata.nextLink': 'http://localhost:8989/withrepeat.svc/Submissions.children.child?%24skip=2',
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
          done();
        }));
      });

      it('should offset subtable row data', (done) => {
        const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
        const query = { $skip: 1 };
        const inRows = streamTest.fromObjects([
          mockSubmission('one', testData.instances.withrepeat.one),
          mockSubmission('two', testData.instances.withrepeat.two),
          mockSubmission('three', testData.instances.withrepeat.three)
        ]);
        rowStreamToOData(form, 'Submissions.children.child', 'http://localhost:8989', '/withrepeat.svc/Submissions.children.child?$skip=2', query, inRows).pipe(streamTest.toText((_, result) => {
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
        }));
      });

      it('should limit and offset subtable row data', (done) => {
        const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
        const query = { $skip: 1, $top: 1 };
        const inRows = streamTest.fromObjects([
          mockSubmission('one', testData.instances.withrepeat.one),
          mockSubmission('two', testData.instances.withrepeat.two),
          mockSubmission('three', testData.instances.withrepeat.three)
        ]);
        rowStreamToOData(form, 'Submissions.children.child', 'http://localhost:8989', '/withrepeat.svc/Submissions.children.child?$skip=1&$top=1', query, inRows).pipe(streamTest.toText((_, result) => {
          JSON.parse(result).should.eql({
            '@odata.context': 'http://localhost:8989/withrepeat.svc/$metadata#Submissions.children.child',
            '@odata.nextLink': 'http://localhost:8989/withrepeat.svc/Submissions.children.child?%24skip=2',
            value: [{
              __id: 'c76d0ccc6d5da236be7b93b985a80413d2e3e172',
              '__Submissions-id': 'two',
              name: 'Blaine',
              age: 6
            }]
          });
          done();
        }));
      });
    });
  });

  describe('single submission output', () => {
    describe('table verification', () => {
      it('should reject with not found if the toplevel table is wrong', () => {
        const form = { xmlFormId: 'simple', schema: () => getFormSchema({ xml: testData.forms.simple }) };
        const submission = mockSubmission('one', testData.instances.simple.one);
        should.throws(() => {
          singleRowToOData(form, submission, 'http://localhost:8989', "/simple.svc/Nonexistent('one')", {});
        });
      });

      it('should reject with not found if a subtable is wrong', () => {
        const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
        const submission = mockSubmission('one', testData.instances.withrepeat.one);
        should.throws(() => {
          singleRowToOData(form, submission, 'http://localhost:8989', "/withrepeat.svc/Submissions('one')/children/child/nonexistent", {});
        });
      });

      it('should pass if the toplevel table is correct', () => {
        const form = { xmlFormId: 'simple', schema: () => getFormSchema({ xml: testData.forms.simple }) };
        const submission = mockSubmission('one', testData.instances.simple.one);
        should.doesNotThrow(() => {
          singleRowToOData(form, submission, 'http://localhost:8989', "/simple.svc/Submissions('one')", {});
        });
      });

      it('should pass if the subtable is correct', () => {
        const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
        const submission = mockSubmission('one', testData.instances.withrepeat.one);
        should.doesNotThrow(() => {
          singleRowToOData(form, submission, 'http://localhost:8989', "/withrepeat.svc/Submissions('one')/children/child", {});
        });
      });
    });

    describe('metadata generation', () => {
      it('should provide the correct context url for the toplevel table', () => {
        const form = { xmlFormId: 'simple', schema: () => getFormSchema({ xml: testData.forms.simple }) };
        const submission = mockSubmission('one', testData.instances.simple.one);
        return singleRowToOData(form, submission, 'http://localhost:8989', "/simple.svc/Submissions('one')", {})
          .then(JSON.parse)
          .then((result) => {
            result['@odata.context'].should.equal('http://localhost:8989/simple.svc/$metadata#Submissions')
          });
      });

      it('should provide the correct context url for a subtable', () => {
        const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
        const submission = mockSubmission('one', testData.instances.withrepeat.one);
        return singleRowToOData(form, submission, 'http://localhost:8989', "/withrepeat.svc/Submissions('one')/children/child", {})
          .then(JSON.parse)
          .then((result) => {
            result['@odata.context'].should.equal('http://localhost:8989/withrepeat.svc/$metadata#Submissions.children.child')
          });
      });

      it('should provide no nextUrl if the final row is accounted for', () => {
        const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
        const submission = mockSubmission('two', testData.instances.withrepeat.two);
        return singleRowToOData(form, submission, 'http://localhost:8989', "/withrepeat.svc/Submissions('two')/children/child", {})
          .then(JSON.parse)
          .then((result) => {
            should.not.exist(result['@odata.nextLink']);
          });
      });

      it('should provide the correct nextUrl if rows remain', () => {
        const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
        const submission = mockSubmission('two', testData.instances.withrepeat.two);
        const query = { $top: 1 };
        return singleRowToOData(form, submission, 'http://localhost:8989', "/withrepeat.svc/Submissions('two')/children/child?$top=1", query)
          .then(JSON.parse)
          .then((result) => {
            result['@odata.nextLink'].should.equal("http://localhost:8989/withrepeat.svc/Submissions('two')/children/child?%24skip=1");
          });
      });

      it('should retain other parameters when giving the nextUrl', () => {
        const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
        const submission = mockSubmission('two', testData.instances.withrepeat.two);
        const query = { $top: 1, $wkt: 'true' };
        return singleRowToOData(form, submission, 'http://localhost:8989', "/withrepeat.svc/Submissions('two')/children/child?$top=1&$wkt=true", query)
          .then(JSON.parse)
          .then((result) => {
            result['@odata.nextLink'].should.equal("http://localhost:8989/withrepeat.svc/Submissions('two')/children/child?%24wkt=true&%24skip=1");
          });
      });

      it('should provide the row count if requested', () => {
        const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
        const submission = mockSubmission('two', testData.instances.withrepeat.two);
        const query = { $count: 'true' };
        return singleRowToOData(form, submission, 'http://localhost:8989', "/withrepeat.svc/Submissions('two')/children/child?$count=true", query)
          .then(JSON.parse)
          .then((result) => {
            result['@odata.count'].should.equal(2);
          });
      });

      it('should provide the full row count even if windowed', () => {
        const form = { xmlFormId: 'withrepeat', schema: () => getFormSchema({ xml: testData.forms.withrepeat }) };
        const submission = mockSubmission('two', testData.instances.withrepeat.two);
        const query = { $top: '1', $count: 'true' };
        return singleRowToOData(form, submission, 'http://localhost:8989', "/withrepeat.svc/Submissions('two')/children/child?$top=1$count=true", query)
          .then(JSON.parse)
          .then((result) => {
            result['@odata.count'].should.equal(2);
          });
      });
    });

    describe('row data output', () => {
      it('should output single instance data', () => {
        const form = { xmlFormId: 'doubleRepeat', schema: () => getFormSchema({ xml: testData.forms.doubleRepeat }) };
        const submission = mockSubmission('double', testData.instances.doubleRepeat.double);
        return singleRowToOData(form, submission, 'http://localhost:8989', "/doubleRepeat.svc/Submissions('double')", {})
          .then(JSON.parse)
          .then((result) => {
            result.should.eql({
              '@odata.context': 'http://localhost:8989/doubleRepeat.svc/$metadata#Submissions',
              value: [{
                __id: 'double',
                __system,
                meta: { instanceID: 'double' },
                name: 'Vick',
                children: {}
              }]
            });
          });
      });

      it('should filter to a single subinstance', () => {
        const form = { xmlFormId: 'doubleRepeat', schema: () => getFormSchema({ xml: testData.forms.doubleRepeat }) };
        const submission = mockSubmission('double', testData.instances.doubleRepeat.double);
        return singleRowToOData(form, submission, 'http://localhost:8989', "/doubleRepeat.svc/Submissions('double')/children/child('b6e93a81a53eed0566e65e472d4a4b9ae383ee6d')/toys/toy", {})
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

      it('should limit subtable data', () => {
        const form = { xmlFormId: 'doubleRepeat', schema: () => getFormSchema({ xml: testData.forms.doubleRepeat }) };
        const submission = mockSubmission('double', testData.instances.doubleRepeat.double);
        const query = { $top: '2' };
        return singleRowToOData(form, submission, 'http://localhost:8989', "/doubleRepeat.svc/Submissions('double')/children/child('b6e93a81a53eed0566e65e472d4a4b9ae383ee6d')/toys/toy?$top=2", query)
          .then(JSON.parse)
          .then((result) => {
            result.should.eql({
              '@odata.context': 'http://localhost:8989/doubleRepeat.svc/$metadata#Submissions.children.child.toys.toy',
              '@odata.nextLink': "http://localhost:8989/doubleRepeat.svc/Submissions('double')/children/child('b6e93a81a53eed0566e65e472d4a4b9ae383ee6d')/toys/toy?%24skip=2",
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

      it('should offset subtable data', () => {
        const form = { xmlFormId: 'doubleRepeat', schema: () => getFormSchema({ xml: testData.forms.doubleRepeat }) };
        const submission = mockSubmission('double', testData.instances.doubleRepeat.double);
        const query = { $skip: '1' };
        return singleRowToOData(form, submission, 'http://localhost:8989', "/doubleRepeat.svc/Submissions('double')/children/child('b6e93a81a53eed0566e65e472d4a4b9ae383ee6d')/toys/toy?$skip=1", query)
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

      it('should limit and offset subtable data', () => {
        const form = { xmlFormId: 'doubleRepeat', schema: () => getFormSchema({ xml: testData.forms.doubleRepeat }) };
        const submission = mockSubmission('double', testData.instances.doubleRepeat.double);
        const query = { $skip: '1', $top: '2' };
        return singleRowToOData(form, submission, 'http://localhost:8989', "/doubleRepeat.svc/Submissions('double')/children/child('b6e93a81a53eed0566e65e472d4a4b9ae383ee6d')/toys/toy?$skip=1&$top=2", query)
          .then(JSON.parse)
          .then((result) => {
            result.should.eql({
              '@odata.context': 'http://localhost:8989/doubleRepeat.svc/$metadata#Submissions.children.child.toys.toy',
              '@odata.nextLink': "http://localhost:8989/doubleRepeat.svc/Submissions('double')/children/child('b6e93a81a53eed0566e65e472d4a4b9ae383ee6d')/toys/toy?%24skip=3",
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

