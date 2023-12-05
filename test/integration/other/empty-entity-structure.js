const { testService } = require('../setup');

// In response to central issues #551, #552, #553, we changed the entity form xml parsing
// to always set the <entity> field to type 'structure' even if it had no children.
// Previously, it would take on the type 'unknown', which caused problems described in the issues.
// This set of tests is intended to check that there are no unintended consequences of having
// an empty structural field like entity.

const emptyEntityForm = `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
  <h:head>
    <model entities:entities-version="2023.1.0">
      <instance>
        <data id="emptyEntity" orx:version="1.0">
          <age/>
          <location>
            <hometown></hometown>
          </location>
          <meta>
            <entity dataset="people" id="" create="" update="" baseVersion="" />
          </meta>
        </data>
        <other/>
      </instance>
      <bind nodeset="/data/age" type="int" entities:saveto="age"/>
      <bind nodeset="/data/location/hometown" type="string" entities:saveto="hometown"/>
    </model>
  </h:head>
</h:html>`;

const emptyEntitySub = `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="emptyEntity" version="1.0">
<meta>
  <instanceID>one</instanceID>
  <orx:instanceName>one</orx:instanceName>
  <entity baseVersion="1" dataset="people" id="12345678-1234-4123-8234-123456789abc" update="1"/>
</meta>
<age>88</age>
<location>
  <hometown></hometown>
</location>
</data>`;

describe('empty entity structure field', () => {
  describe('submission diffing', () => {
    it('should check simple diff case', testService(async (service) => {
      const sub2 = emptyEntitySub.replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>one2')
        .replace('<hometown></hometown>', '<hometown>seattle</hometown>')
        .replace('<age>88</age>', '<age></age>');

      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(emptyEntityForm)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/emptyEntity/submissions')
        .send(emptyEntitySub)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.put('/v1/projects/1/forms/emptyEntity/submissions/one')
        .send(sub2)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.get('/v1/projects/1/forms/emptyEntity/submissions/one/diffs')
        .set('X-Extended-Metadata', true)
        .expect(200)
        .then(({ body }) => {
          // looks fine without entity child
          body.one2.should.eql([
            { old: 'one', new: 'one2', path: [ 'meta', 'instanceID' ] },
            { new: 'one', path: [ 'meta', 'deprecatedID' ] },
            { old: '88', new: '', path: [ 'age' ] },
            { old: '', new: 'seattle', path: [ 'location', 'hometown' ] }
          ]);
        });
    }));

    it.skip('should check diff when form version changes to add label', testService(async (service) => {
      const form2 = emptyEntityForm
        .replace('<entity dataset="people" id="" create="" update="" baseVersion="" />',
          '<entity dataset="people" id="" create="" update="" baseVersion=""><label/></entity>')
        .replace('orx:version="1.0"', 'orx:version="2.0"');

      const sub2 = `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="emptyEntity" version="2.0">
        <meta>
          <deprecatedID>one</deprecatedID>
          <instanceID>one2</instanceID>
          <orx:instanceName>one</orx:instanceName>
          <entity baseVersion="1" dataset="people" id="12345678-1234-4123-8234-123456789abc" update="1">
            <label>foo</label>
          <entity>
        </meta>
        <age>77</age>
        <location>
          <hometown>san francisco</hometown>
        </location>
      </data>`;

      const sub3 = `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="emptyEntity" version="1.0">
        <meta>
          <deprecatedID>one2</deprecatedID>
          <instanceID>one3</instanceID>
          <orx:instanceName>one</orx:instanceName>
          <entity baseVersion="1" dataset="people" id="12345678-1234-4123-8234-123456789abc" update="1">
          <entity>
        </meta>
        <age>99</age>
        <location>
          <hometown>san francisco</hometown>
        </location>
      </data>`;

      const asAlice = await service.login('alice');

      // first version of the form
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(emptyEntityForm)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // first version of the submission
      await asAlice.post('/v1/projects/1/forms/emptyEntity/submissions')
        .send(emptyEntitySub)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // second version of the form with label added
      await asAlice.post('/v1/projects/1/forms/emptyEntity/draft')
        .send(form2)
        .set('Content-Type', 'text/xml')
        .expect(200);
      await asAlice.post('/v1/projects/1/forms/emptyEntity/draft/publish')
        .expect(200);

      // edit the submission
      await asAlice.put('/v1/projects/1/forms/emptyEntity/submissions/one')
        .send(sub2)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // edit again using old form version
      await asAlice.put('/v1/projects/1/forms/emptyEntity/submissions/one')
        .send(sub3)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.get('/v1/projects/1/forms/emptyEntity/submissions/one/diffs')
        .set('X-Extended-Metadata', true)
        .expect(200)
        .then(({ body }) => {
          console.log(body.one2);
          // not great:
          // { new: 'foo', path: [ 'meta', 'entity', 'label' ] }, // entity label looks good
          // { new: '\n      ', path: [ 'meta', 'entity', 'entity' ] }, // entity path looks wonky
          console.log(body.one3);
          // not great: entity path is wonky, label is weird - saw this when indentation in xml was off
          // this whole case where we remove a structural field is also kind of weird, though
          // editing a submission with an earlier form version is also weird
          //   {
          // old: '\n      ',
          // new: '\n    ',
          // path: [ 'meta', 'entity', 'entity' ]
          // },
          // with indentation fixed, it looks ok, except frontend might never anticipate new being undefined.
          // { old: 'foo', path: [ 'meta', 'entity', 'label' ] },
        });
    }));
  });

  describe('odata', () => {
    it('should show submissions in odata', testService(async (service) => {
      const asAlice = await service.login('alice');
      // first version of the form
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(emptyEntityForm)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/emptyEntity/submissions')
        .send(emptyEntitySub)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.get('/v1/projects/1/forms/emptyEntity.svc/Submissions')
        .expect(200)
        .then(({ body }) => {
          // this seems ok
          body.value[0].meta.should.eql({ entity: {} });
        });
    }));

    it('should show submissions in odata when label added', testService(async (service) => {
      const asAlice = await service.login('alice');
      // first version of the form
      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(emptyEntityForm)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // submission to first form version
      await asAlice.post('/v1/projects/1/forms/emptyEntity/submissions')
        .send(emptyEntitySub)
        .set('Content-Type', 'application/xml')
        .expect(200);

      const form2 = emptyEntityForm
        .replace('<entity dataset="people" id="" create="" update="" baseVersion="" />',
          '<entity dataset="people" id="" create="" update="" baseVersion=""><label/></entity>')
        .replace('orx:version="1.0"', 'orx:version="2.0"');

      const sub2 = `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="emptyEntity" version="1.0">
        <meta>
          <instanceID>two</instanceID>
          <orx:instanceName>two</orx:instanceName>
          <entity baseVersion="1" dataset="people" id="12345678-1234-4123-8234-123456789abc" update="1">
            <label>foo</label>
          <entity>
        </meta>
        <age>77</age>
        <location>
          <hometown>san francisco</hometown>
        </location>
      </data>`;

      // second version of the form with label added
      await asAlice.post('/v1/projects/1/forms/emptyEntity/draft')
        .send(form2)
        .set('Content-Type', 'text/xml')
        .expect(200);
      await asAlice.post('/v1/projects/1/forms/emptyEntity/draft/publish')
        .expect(200);

      // new submission
      await asAlice.post('/v1/projects/1/forms/emptyEntity/submissions')
        .send(sub2)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.get('/v1/projects/1/forms/emptyEntity.svc/Submissions')
        .expect(200)
        .then(({ body }) => {
          // seems ok
          body.value[0].meta.should.eql({ entity: { label: 'foo' } });
          body.value[1].meta.should.eql({ entity: { label: null } });
        });
    }));
  });
});
