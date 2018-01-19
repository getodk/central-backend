
const simple = `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <h:title>Simple</h:title>
    <model>
      <instance>
        <data id="simple">
          <meta>
            <instanceID/>
          </meta>
          <name/>
          <age/>
        </data>
      </instance>

      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
      <bind nodeset="/data/name" type="string"/>
      <bind nodeset="/data/age" type="int"/>
    </model>

  </h:head>
  <h:body>
    <input ref="/data/name">
      <label>What is your name?</label>
    </input>
    <input ref="/data/age">
      <label>What is your age?</label>
    </input>
  </h:body>
</h:html>`;

const withrepeat = `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <model>
      <instance>
        <data id="withrepeat">
          <orx:meta>
            <orx:instanceID/>
          </orx:meta>
          <name/>
          <age/>
          <children>
            <child jr:template="">
              <name/>
              <age/>
            </child>
          </children>
        </data>
      </instance>
      <bind nodeset="/data/meta/instanceID" preload="uid" type="string"/>
      <bind nodeset="/data/name" type="string"/>
      <bind nodeset="/data/age" type="integer"/>
      <bind nodeset="/data/children/child/name" type="string"/>
      <bind nodeset="/data/children/child/age" type="integer"/>
    </model>
  </h:head>
</h:html>`;

const forms = [ simple, withrepeat ];

module.exports = ({ Form }) => Promise.all(forms.map((xml) => Form.fromXml(xml).then((form) => form.create()).point()));

