
// takes care of instance envelope boilerplate.
const instance = (formId, instanceId, data) =>
  `<data id="${formId}"><meta><instanceID>${instanceId}</instanceID></meta>${data}</data>`;

// provides orx: namespace on meta/instanceId and a form version.
const fullInstance = (formId, version, instanceId, data) =>
  `<data id="${formId}" version="${version}"><orx:meta><orx:instanceID>${instanceId}</orx:instanceID></orx:meta>${data}</data>`;

module.exports = {
  forms: {
    simple: `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
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
</h:html>`,

    withrepeat: `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms">
  <h:head>
    <model>
      <instance>
        <data id="withrepeat" orx:version="1.0">
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
      <bind nodeset="/data/orx:meta/orx:instanceID" preload="uid" type="string"/>
      <bind nodeset="/data/name" type="string"/>
      <bind nodeset="/data/age" type="int"/>
      <bind nodeset="/data/children/child/name" type="string"/>
      <bind nodeset="/data/children/child/age" type="int"/>
    </model>
  </h:head>
  <h:body>
    <input ref="/data/name">
      <label>What is your name?</label>
    </input>
    <input ref="/data/age">
      <label>What is your age?</label>
    </input>
    <group ref="/data/children/child">
      <label>Child</label>
      <repeat nodeset="/data/children/child">
        <input ref="/data/children/child/name">
          <label>What is the child's name?</label>
        </input>
        <input ref="/data/children/child/age">
          <label>What is the child's age?</label>
        </input>
      </repeat>
    </group>
  </h:body>
</h:html>`,

    simple2: `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <h:title>Simple 2</h:title>
    <model>
      <instance>
        <data id="simple2" version="2.1">
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
</h:html>`,

    doubleRepeat: `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms">
  <h:head>
    <model>
      <instance>
        <data id="doubleRepeat" orx:version="1.0">
          <orx:meta>
            <orx:instanceID/>
          </orx:meta>
          <name/>
          <children>
            <child>
              <name/>
              <toys>
                <toy>
                  <name/>
                </toy>
              </toys>
            </child>
          </children>
        </data>
      </instance>
      <bind nodeset="/data/orx:meta/orx:instanceID" preload="uid" type="string"/>
      <bind nodeset="/data/name" type="string"/>
      <bind nodeset="/data/children/child/name" type="string"/>
      <bind nodeset="/data/children/child/toys/toy/name" type="string"/>
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
        <group ref="/data/children/child/toys">
          <label>Child</label>
          <repeat nodeset="/data/children/child/toys/toy">
            <input ref="/data/children/child/toys/toy/name">
              <label>What is the toy's name?</label>
            </input>
          </repeat>
        </group>
      </repeat>
    </group>
  </h:body>
</h:html>`,

    withAttachments: `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <model>
      <instance>
        <data id="withAttachments">
          <meta>
            <instanceID/>
          </meta>
          <name/>
          <age/>
          <hometown/>
        </data>
      </instance>
      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
      <instance id="mydata" src="badnoroot.xls"/>
      <instance id="seconddata" src="jr://files/badsubpath.csv"/>
      <instance id="thirddata" src="jr://file/goodone.csv"/>
      <instance id="fourthdata" src="jr://file/path/to/badnestedfile.csv"/>
      <bind nodeset="/data/name" type="string"/>
      <bind type="int" nodeset="/data/age"/>
      <bind nodeset="/data/hometown" type="select1"/>
      <itext>
        <translation default="true()" lang="en">
          <text id="/data/name:label">
            <value form="audio">jr://audio/goodtwo.mp3</value>
          </text>
        </translation>
      </itext>
    </model>
  </h:head>
</h:html>`,

    itemsets: `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <model>
      <instance>
        <data id="itemsets">
          <meta>
            <instanceID/>
          </meta>
          <name/>
        </data>
      </instance>
      <instance id="itemsets" src="jr://file/itemsets.csv"/>
      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
      <bind nodeset="/data/name" type="string"/>
    </model>
  </h:head>
</h:html>`,

    binaryType: `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <h:title>Submission </h:title>
    <model>
      <instance>
        <data id="binaryType">
          <meta>
            <instanceID/>
          </meta>
          <file1/>
          <file2/>
        </data>
      </instance>

      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
      <bind nodeset="/data/file1" type="binary"/>
      <bind nodeset="/data/file2" type="binary"/>
    </model>

  </h:head>
  <h:body>
    <upload ref="/data/file1" mediatype="image/*">
      <label>Give me an image.</label>
    </upload>
    <upload ref="/data/file2" mediatype="video/*">
      <label>Give me a video./label>
    </upload>
  </h:body>
</h:html>`,

    encrypted: `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <h:title>Encrypted</h:title>
    <model>
      <instance>
        <data id="encrypted" version="working3">
          <meta>
            <instanceID/>
          </meta>
          <name/>
          <age/>
          <file/>
        </data>
      </instance>

      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
      <bind nodeset="/data/name" type="string"/>
      <bind nodeset="/data/age" type="int"/>
      <bind nodeset="/data/file" type="binary"/>

      <submission base64RsaPublicKey="MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyYh7bSui/0xppQ+J3i5xghfao+559Rqg9X0xNbdMEsW35CzYUfmC8sOzeeUiE4pG7HIEUmiJal+mo70UMDUlywXj9z053n0g6MmtLlUyBw0ZGhEZWHsfBxPQixdzY/c5i7sh0dFzWVBZ7UrqBc2qjRFUYxeXqHsAxSPClTH1nW47Mr2h4juBLC7tBNZA3biZA/XTPt//hAuzv1d6MGiF3vQJXvFTNdfsh6Ckq4KXUsAv+07cLtON4KjrKhqsVNNGbFssTUHVL4A9N3gsuRGt329LHOKBxQUGEnhMM2MEtvk4kaVQrgCqpk1pMU/4HlFtRjOoKdAIuzzxIl56gNdRUQIDAQAB"/>
    </model>

  </h:head>
  <h:body>
    <input ref="/data/name">
      <label>What is your name?</label>
    </input>
    <input ref="/data/age">
      <label>What is your age?</label>
    </input>
    <upload ref="/data/file" mediatype="image/*">
      <label>Give me an image.</label>
    </upload>
  </h:body>
</h:html>`,

    clientAudits: `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <h:title>Client Audits</h:title>
    <model>
      <instance>
        <data id="audits">
          <meta>
            <instanceID/>
            <audit/>
          </meta>
          <name/>
          <age/>
        </data>
      </instance>

      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
      <bind nodeset="/data/meta/audit" type="binary"/>
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
</h:html>`,

    selectMultiple: `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <model>
      <instance>
        <data id="selectMultiple">
          <meta>
            <instanceID/>
          </meta>
          <q1/>
          <g1><q2/></g1>
        </data>
      </instance>
      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
      <bind nodeset="/data/q1" type="string"/>
      <bind nodeset="/data/g1/q2" type="string"/>
    </model>
  </h:head>
  <h:body>
    <select ref="/data/q1"><label>one</label></select>
    <group ref="/data/g1">
      <label>group</label>
      <select ref="/data/g1/q2"><label>two</label></select>
    </group>
  </h:body>
</h:html>`,

    simpleEntity: `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
  <h:head>
    <model entities:entities-version="2024.1.0">
      <instance>
        <data id="simpleEntity" orx:version="1.0">
          <name/>
          <age/>
          <hometown/>
          <meta>
            <entity dataset="people" id="" create="">
              <label/>
            </entity>
          </meta>
        </data>
      </instance>
      <bind nodeset="/data/name" type="string" entities:saveto="first_name"/>
      <bind nodeset="/data/age" type="int" entities:saveto="age"/>
      <bind nodeset="/data/hometown" type="string"/>
    </model>
  </h:head>
</h:html>`,

    // Copy of the above form with the original entities-version
    simpleEntity2022: `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
  <h:head>
    <model entities:entities-version="2022.1.0">
      <instance>
        <data id="simpleEntity" orx:version="1.0">
          <name/>
          <age/>
          <hometown/>
          <meta>
            <entity dataset="people" id="" create="">
              <label/>
            </entity>
          </meta>
        </data>
      </instance>
      <bind nodeset="/data/name" type="string" entities:saveto="first_name"/>
      <bind nodeset="/data/age" type="int" entities:saveto="age"/>
      <bind nodeset="/data/hometown" type="string"/>
    </model>
  </h:head>
</h:html>`,

    multiPropertyEntity: `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
  <h:head>
    <model entities:entities-version="2024.1.0">
      <instance>
        <data id="multiPropertyEntity" orx:version="1.0">
          <q1/>
          <q2/>
          <q3/>
          <q4/>
          <meta>
            <entity dataset="foo" id="" create="">
              <label/>
            </entity>
          </meta>
        </data>
      </instance>
      <bind entities:saveto="a_q3" nodeset="/data/q3" type="string"/>
      <bind entities:saveto="b_q1" nodeset="/data/q1" type="string"/>
      <bind entities:saveto="c_q4" nodeset="/data/q4" type="string"/>
      <bind entities:saveto="d_q2" nodeset="/data/q2" type="string"/>
    </model>
  </h:head>
</h:html>`,

    updateEntity: `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
  <h:head>
    <model entities:entities-version="2024.1.0">
      <instance>
        <data id="updateEntity" orx:version="1.0">
          <name/>
          <age/>
          <hometown/>
          <meta>
            <entity dataset="people" id="" update="" baseVersion="" branchId="" trunkVersion="">
              <label/>
            </entity>
          </meta>
        </data>
      </instance>
      <bind nodeset="/data/name" type="string" entities:saveto="first_name"/>
      <bind nodeset="/data/age" type="int" entities:saveto="age"/>
    </model>
  </h:head>
</h:html>`,

    // Copy of the above form with the original entities-version spec
    updateEntity2023: `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
  <h:head>
    <model entities:entities-version="2023.1.0">
      <instance>
        <data id="updateEntity" orx:version="1.0">
          <name/>
          <age/>
          <hometown/>
          <meta>
            <entity dataset="people" id="" update="" baseVersion="">
              <label/>
            </entity>
          </meta>
        </data>
      </instance>
      <bind nodeset="/data/name" type="string" entities:saveto="first_name"/>
      <bind nodeset="/data/age" type="int" entities:saveto="age"/>
    </model>
  </h:head>
</h:html>`,

    offlineEntity: `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
  <h:head>
    <model entities:entities-version="2024.1.0">
      <instance>
        <data id="offlineEntity" orx:version="1.0">
          <name/>
          <age/>
          <status/>
          <meta>
            <entity dataset="people" id="" create="" update="" baseVersion="" trunkVersion="" branchId="">
              <label/>
            </entity>
          </meta>
        </data>
      </instance>
      <bind nodeset="/data/name" type="string" entities:saveto="first_name"/>
      <bind nodeset="/data/age" type="int" entities:saveto="age"/>
      <bind nodeset="/data/status" type="int" entities:saveto="status"/>
    </model>
  </h:head>
</h:html>`,

    repeatEntityTrees: `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:entities="http://www.opendatakit.org/xforms/entities" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" xmlns:odk="http://www.opendatakit.org/xforms">
    <h:head>
        <h:title>Repeat Trees</h:title>
        <model odk:xforms-version="1.0.0" entities:entities-version="2025.1.0">
            <instance>
                <data id="repeatEntityTrees" version="1">
                    <plot_id/>
                    <tree>
                        <species/>
                        <circumference/>
                        <meta>
                            <entity dataset="trees" create="" update="" id="">
                                <label/>
                            </entity>
                        </meta>
                    </tree>
                    <meta>
                        <instanceID/>
                    </meta>
                </data>
            </instance>
            <bind nodeset="/data/plot_id" type="string"/>
            <bind nodeset="/data/tree/species" type="string" entities:saveto="species"/>
            <bind nodeset="/data/tree/circumference" type="int" entities:saveto="circumference"/>
            <bind nodeset="/data/tree/meta/entity/@id" type="string"/>
            <setvalue event="odk-instance-first-load odk-new-repeat" ref="/data/tree/meta/entity/@id" value="uuid()"/>
            <bind nodeset="/data/tree/meta/entity/label" calculate="../../../species" type="string"/>
            <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" jr:preload="uid"/>
        </model>
    </h:head>
    <h:body>
        <input ref="/data/plot_id">
            <label>Enter the ID of the plot</label>
        </input>
        <group ref="/data/tree">
            <label>Enter info about each tree</label>
            <repeat nodeset="/data/tree">
                <input ref="/data/tree/species">
                    <label>Tree Species</label>
                </input>
                <input ref="/data/tree/circumference">
                    <label>Tree Circumference</label>
                </input>
            </repeat>
        </group>
    </h:body>
</h:html>`,

    repeatEntityHousehold: `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:entities="http://www.opendatakit.org/xforms/entities">
    <h:head>
        <h:title>Household and people</h:title>
        <model odk:xforms-version="1.0.0" entities:entities-version="2025.1.0">
            <instance>
                <data id="repeatEntityHousehold" version="2">
                    <household_id/>
                    <members>
                        <num_people/>
                        <person>
                            <name/>
                            <age/>
                            <meta>
                                <entity dataset="people" create="" id="">
                                    <label/>
                                </entity>
                            </meta>
                        </person>
                    </members>
                    <meta>
                        <instanceID/>
                        <entity dataset="households" id="" create="1">
                            <label/>
                        </entity>
                    </meta>
                </data>
            </instance>
            <bind nodeset="/data/household_id" type="string" entities:saveto="hh_id"/>
            <bind nodeset="/data/members/num_people" type="int" entities:saveto="count"/>
            <bind nodeset="/data/members/person/name" type="string" entities:saveto="full_name"/>
            <bind nodeset="/data/members/person/age" type="int" entities:saveto="age"/>
            
            <bind nodeset="/data/members/person/meta/entity/@id" type="string"/>
            <setvalue event="odk-instance-first-load odk-new-repeat" ref="/data/members/person/meta/entity/@id" value="uuid()"/>
            <bind nodeset="/data/members/person/meta/entity/label" calculate="../../../name" type="string"/>
            <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" jr:preload="uid"/>
            <bind nodeset="/data/meta/entity/@id" type="string" readonly="true()"/>
            <setvalue ref="/data/meta/entity/@id" event="odk-instance-first-load" type="string" readonly="true()" value="uuid()"/>
            <bind nodeset="/data/meta/entity/label" calculate="concat(&quot;Household:&quot;,  /data/household_id )" type="string" readonly="true()"/>
        </model>
    </h:head>
    <h:body>
        <input ref="/data/household_id">
            <label>Enter the household ID</label>
        </input>
        <group ref="/data/members">
            <label>Household information</label>
            <input ref="/data/members/num_people">
                <label>Number of people in the household</label>
            </input>
            <group ref="/data/members/person">
                <label>Enter information about each person of the household</label>
                <repeat nodeset="/data/members/person">
                    <input ref="/data/members/person/name">
                        <label>First name</label>
                    </input>
                    <input ref="/data/members/person/age">
                        <label>Age</label>
                    </input>
                </repeat>
            </group>
        </group>
    </h:body>
</h:html>`,

    multiEntityFarm: `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:entities="http://www.opendatakit.org/xforms/entities">
    <h:head>
        <h:title>Farms and Farmers - Multi Level Entities</h:title>
        <model odk:xforms-version="1.0.0" entities:entities-version="2025.1.0">
            <instance>
                <data id="multiEntityFarm" version="2">
                    <farm>
                        <farm_id/>
                        <location/>
                        <acres/>
                        <farmer>
                            <farmer_name/>
                            <age/>
                            <meta>
                                <entity dataset="farmers" create="" id="">
                                    <label/>
                                </entity>
                            </meta>
                        </farmer>
                        <meta>
                            <entity dataset="farms" id="" create="1">
                                <label/>
                            </entity>
                        </meta>
                    </farm>
                    <meta>
                        <instanceID/>
                        <instanceName/>
                    </meta>
                </data>
            </instance>
            <bind nodeset="/data/farm/farm_id" type="string" entities:saveto="farm_id"/>
            <bind nodeset="/data/farm/location" type="geopoint" entities:saveto="geometry"/>
            <bind nodeset="/data/farm/acres" type="int" entities:saveto="acres"/>
            <bind nodeset="/data/farm/farmer/farmer_name" type="string" entities:saveto="full_name"/>
            <bind nodeset="/data/farm/farmer/age" type="int" entities:saveto="age"/>
            <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" jr:preload="uid"/>
            <bind nodeset="/data/meta/instanceName" type="string" calculate="concat(&quot;Farm &quot;,  /data/farm/farm_id , &quot;-&quot;,  /data/farm/farmer/farmer_name )"/>
            <bind nodeset="/data/farm/meta/entity/@id" type="string" readonly="true()"/>
            <setvalue ref="/data/farm/meta/entity/@id" event="odk-instance-first-load" type="string" readonly="true()" value="uuid()"/>
            <bind nodeset="/data/farm/meta/entity/label" calculate="concat(&quot;Farm &quot;,  /data/farm/farm_id )" type="string" readonly="true()"/>
            <bind nodeset="/data/farm/farmer/meta/entity/@id" type="string" readonly="true()"/>
            <setvalue ref="/data/farm/farmer/meta/entity/@id" event="odk-instance-first-load" type="string" readonly="true()" value="uuid()"/>
            <bind nodeset="/data/farm/farmer/meta/entity/label" calculate="concat(&quot;Farmer &quot;,  /data/farm/farmer/farmer_name )" type="string" readonly="true()"/>
        </model>
    </h:head>
    <h:body>
        <group ref="/data/farm">
            <label>Enter info about the farm</label>
            <input ref="/data/farm/farm_id">
                <label>Farm ID</label>
            </input>
            <input ref="/data/farm/location">
                <label>Location</label>
            </input>
            <input ref="/data/farm/acres">
                <label>Estimated number of acres</label>
            </input>
            <group ref="/data/farm/farmer">
                <label>Enter info about the primary farmer</label>
                <input ref="/data/farm/farmer/farmer_name">
                    <label>Farmer name</label>
                </input>
                <input ref="/data/farm/farmer/age">
                    <label>Farmer age</label>
                </input>
            </group>
        </group>
    </h:body>
</h:html>`,

    nestedRepeatEntity: `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:entities="http://www.opendatakit.org/xforms/entities">
    <h:head>
        <h:title>nestedRepeatEntities</h:title>
        <model odk:xforms-version="1.0.0" entities:entities-version="2025.1.0">
            <instance>
                <data id="nestedRepeatEntity" version="20250915105318">
                    <plot>
                        <plot_id/>
                        <crop/>
                        <tree>
                            <species/>
                            <health_status/>
                            <meta>
                                <entity dataset="trees" id="" create="1">
                                    <label/>
                                </entity>
                            </meta>
                        </tree>
                        <meta>
                            <entity dataset="plots" id="" create="1">
                                <label/>
                            </entity>
                        </meta>
                    </plot>
                    <meta>
                        <instanceID/>
                    </meta>
                </data>
            </instance>
            <bind nodeset="/data/plot/plot_id" type="string" entities:saveto="plot_id"/>
            <bind nodeset="/data/plot/crop" type="string" entities:saveto="crop"/>
            <bind nodeset="/data/plot/tree/species" type="string" entities:saveto="species"/>
            <bind nodeset="/data/plot/tree/health_status" type="string" entities:saveto="health_status"/>
            <bind nodeset="/data/plot/tree/meta/entity/@id" type="string" readonly="true()"/>
            <setvalue ref="/data/plot/tree/meta/entity/@id" event="odk-instance-first-load odk-new-repeat" type="string" readonly="true()" value="uuid()"/>
            <bind nodeset="/data/plot/tree/meta/entity/label" calculate="concat(&quot;Tree &quot;,  ../../../species )" type="string" readonly="true()"/>
            <bind nodeset="/data/plot/meta/entity/@id" type="string" readonly="true()"/>
            <setvalue ref="/data/plot/meta/entity/@id" event="odk-instance-first-load odk-new-repeat" type="string" readonly="true()" value="uuid()"/>
            <bind nodeset="/data/plot/meta/entity/label" calculate="concat(&quot;Plot &quot;,  ../../../plot_id , &quot;: &quot;,  ../../../crop )" type="string" readonly="true()"/>
            <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" jr:preload="uid"/>
        </model>
    </h:head>
    <h:body>
        <group ref="/data/plot">
            <label>Enter info about each plot</label>
            <repeat nodeset="/data/plot">
                <input ref="/data/plot/plot_id">
                    <label>Enter the ID of the plot</label>
                </input>
                <input ref="/data/plot/crop">
                    <label>Enter the name of the crop</label>
                </input>
                <group ref="/data/plot/tree">
                    <label>Enter info about each tree</label>
                    <repeat nodeset="/data/plot/tree">
                        <input ref="/data/plot/tree/species">
                            <label>Species</label>
                        </input>
                        <input ref="/data/plot/tree/health_status">
                            <label>Health status</label>
                        </input>
                    </repeat>
                </group>
            </repeat>
        </group>
    </h:body>
</h:html>`,

    groupRepeatEntity: `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:entities="http://www.opendatakit.org/xforms/entities">
  <h:head>
    <h:title>Entity in group in repeat</h:title>
    <model odk:xforms-version="1.0.0" entities:entities-version="2025.1.0">
      <instance>
        <data id="groupRepeatEntity" version="20250917095610">
          <tree>
            <tree_id/>
            <tree_details>
              <species/>
              <health_status/>
              <meta>
                <entity dataset="trees" id="" create="1">
                  <label/>
                </entity>
              </meta>
            </tree_details>
          </tree>
          <meta>
            <instanceID/>
          </meta>
        </data>
      </instance>
      <bind nodeset="/data/tree/tree_id" type="string"/>
      <bind nodeset="/data/tree/tree_details/species" type="string" entities:saveto="species"/>
      <bind nodeset="/data/tree/tree_details/health_status" type="string" entities:saveto="health_status"/>
      <bind nodeset="/data/tree/tree_details/meta/entity/@id" type="string" readonly="true()"/>
      <setvalue ref="/data/tree/tree_details/meta/entity/@id" event="odk-instance-first-load odk-new-repeat" type="string" readonly="true()" value="uuid()"/>
      <bind nodeset="/data/tree/tree_details/meta/entity/label" calculate="concat(&quot;Tree &quot;,  ../../../species )" type="string" readonly="true()"/>
      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" jr:preload="uid"/>
    </model>
  </h:head>
  <h:body>
    <group ref="/data/tree">
      <label>Fill out info about trees</label>
      <repeat nodeset="/data/tree">
        <input ref="/data/tree/tree_id">
          <label>Tree ID</label>
        </input>
        <group ref="/data/tree/tree_details">
          <label>Tree Details</label>
          <input ref="/data/tree/tree_details/species">
            <label>Tree Species</label>
          </input>
          <input ref="/data/tree/tree_details/health_status">
            <label>Tree Health</label>
          </input>
        </group>
      </repeat>
    </group>
  </h:body>
</h:html>
`,

    groupRepeat: `<?xml version="1.0"?>
    <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:orx="http://openrosa.org/xforms" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
        <h:head>
            <h:title>groupRepeat</h:title>
            <model odk:xforms-version="1.0.0">
                <instance>
                    <data id="groupRepeat">
                        <text/>
                        <child_repeat jr:template="">
                            <name/>
                            <address>
                                <city/>
                                <country/>
                            </address>
                        </child_repeat>
                        <child_repeat>
                            <name/>
                            <address>
                                <city/>
                                <country/>
                            </address>
                        </child_repeat>
                        <meta>
                            <instanceID/>
                        </meta>
                    </data>
                </instance>
                <bind nodeset="/data/text" type="string"/>
                <bind nodeset="/data/child_repeat/name" type="string"/>
                <bind nodeset="/data/child_repeat/address/city" type="string"/>
                <bind nodeset="/data/child_repeat/address/country" type="string"/>
                <bind jr:preload="uid" nodeset="/data/meta/instanceID" readonly="true()" type="string"/>
            </model>
        </h:head>
        <h:body>
            <input ref="/data/text">
                <label>text</label>
            </input>
            <group ref="/data/child_repeat">
                <label>Children</label>
                <repeat nodeset="/data/child_repeat">
                    <input ref="/data/child_repeat/name">
                        <label>Child's name</label>
                    </input>
                    <group ref="/data/child_repeat/address">
                        <label>group</label>
                        <input ref="/data/child_repeat/address/city">
                            <label>City</label>
                        </input>
                        <input ref="/data/child_repeat/address/country">
                            <label>Country</label>
                        </input>
                    </group>
                </repeat>
            </group>
        </h:body>
    </h:html>`,

    nestedGroup: `<?xml version="1.0"?>
    <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:orx="http://openrosa.org/xforms" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
        <h:head>
            <h:title>nestedGroup</h:title>
            <model odk:xforms-version="1.0.0">
                <instance>
                    <data id="nestedGroup">
                        <text/>
                        <hospital>
                            <name/>
                            <hiv_medication>
                                <have_hiv_medication/>
                            </hiv_medication>
                        </hospital>
                        <meta>
                            <instanceID/>
                        </meta>
                    </data>
                </instance>
                <bind nodeset="/data/text" type="string"/>
                <bind nodeset="/data/hospital/name" type="string"/>
                <bind nodeset="/data/hospital/hiv_medication/have_hiv_medication" type="string"/>
                <bind jr:preload="uid" nodeset="/data/meta/instanceID" readonly="true()" type="string"/>
            </model>
        </h:head>
        <h:body>
            <input ref="/data/text">
                <label>text</label>
            </input>
            <group ref="/data/hospital">
                <label>Hospital</label>
                <input ref="/data/hospital/name">
                    <label>What is the name of this hospital?</label>
                </input>
                <group ref="/data/hospital/hiv_medication">
                    <label>HIV Medication</label>
                    <input ref="/data/hospital/hiv_medication/have_hiv_medication">
                        <label>Does this hospital have HIV medication?</label>
                    </input>
                </group>
            </group>
        </h:body>
    </h:html>`
  },
  instances: {
    simple: {
      one: instance('simple', 'one', '<name>Alice</name><age>30</age>'),
      two: instance('simple', 'two', '<name>Bob</name><age>34</age>'),
      three: instance('simple', 'three', '<name>Chelsea</name><age>38</age>')
    },
    withrepeat: {
      one: fullInstance('withrepeat', '1.0', 'rone', '<name>Alice</name><age>30</age>'),
      two: fullInstance('withrepeat', '1.0', 'rtwo', '<name>Bob</name><age>34</age><children><child><name>Billy</name><age>4</age></child><child><name>Blaine</name><age>6</age></child></children>'),
      three: fullInstance('withrepeat', '1.0', 'rthree', '<name>Chelsea</name><age>38</age><children><child><name>Candace</name><age>2</age></child></children>'),
    },
    simple2: {
      one: fullInstance('simple2', '2.1', 's2one', '<name>Alice</name><age>30</age>'),
      two: fullInstance('simple2', '2.1', 's2two', '<name>Bob</name><age>34</age>'),
      three: fullInstance('simple2', '2.1', 's2three', '<name>Chelsea</name><age>38</age>')
    },
    doubleRepeat: {
      double: `<data id="doubleRepeat" version="1.0">
    <orx:meta><orx:instanceID>double</orx:instanceID></orx:meta>
    <name>Vick</name>
    <children>
      <child>
        <name>Alice</name>
      </child>
      <child>
        <name>Bob</name>
        <toys>
          <toy><name>Twilight Sparkle</name></toy>
          <toy><name>Pinkie Pie</name></toy>
          <toy><name>Applejack</name></toy>
          <toy><name>Spike</name></toy>
        </toys>
      </child>
      <child>
        <name>Chelsea</name>
        <toys>
          <toy><name>Rainbow Dash</name></toy>
          <toy><name>Rarity</name></toy>
          <toy><name>Fluttershy</name></toy>
          <toy><name>Princess Luna</name></toy>
        </toys>
      </child>
    </children>
  </data>`
    },
    binaryType: {
      one: instance('binaryType', 'bone', '<file1>my_file1.mp4</file1>'),
      two: instance('binaryType', 'btwo', '<file2>here_is_file2.jpg</file2>'),
      both: instance('binaryType', 'both', '<file1>my_file1.mp4</file1><file2>here_is_file2.jpg</file2>'),
      unicode: instance('binaryType', 'both', '<file1>fîlé2</file1><file2>f😂le3صادق</file2>'),
      withFile: (filename) => instance('binaryType', 'with-file', `<file1>${filename}</file1>`),
    },
    encrypted: {
      // TODO: the jpg binary associated with this sample blob is >3MB. will replace
      // with something i actually feel comfortable committing.
      one: `<data id="encrypted" version="working3" encrypted="yes" xmlns="http://www.opendatakit.org/xforms/encrypted">
  <base64EncryptedKey>pFT0+tIo8l104xRF8MkyG955oI0eLvdp/Vxy4UH6AvpGVW8fpotfv4Rc51PeDn9jV7kmNk2Q9WGwJs2YmYipxwAZT8genpktoYQR77nT3nqMpkzDfVXLGyl9o8lfuVZNjMRGkaI4Vy7DdsYJI1tkPY03sEopZIBHOl9Du9anyn9FIDbGgcC+W8GDx4jnYRAD3joDFK4wHZTZF7D5/OoDSQjxcMpM6TPmEDPszjHpfXbkf8mtTvy2F5knG9HWmFbaJRy8POC9GQrh68xK8RUJbQX8PBCt/zgR+rTibolgoIKy5KplAS/wKQoi19QfwVRAq9jDzDJeW22tdmBa86X/Fg==</base64EncryptedKey>
  <orx:meta xmlns:orx="http://openrosa.org/xforms"><orx:instanceID>uuid:dcf4a151-5088-453f-99e6-369d67828f7a</orx:instanceID></orx:meta>
  <media><file>1561432508817.jpg.enc</file></media>
  <encryptedXmlFile>submission.xml.enc</encryptedXmlFile>
  <base64EncryptedElementSignature>UHIobs8lmLCeKGoPxVFiwXp5JsItoBEwdgmUPF8evnmvRd7Tm1o1wOh9WQNcTGXU+uBH0c/w4UkcFq/GA7JYzxjuMu8QGbjlVd936MM0ynAsrzRxHkiZChnabObeCYzab24dHZooiraVs/yPeyGKykJRpAz3jcXNEUz9X7qLrscEab0wvFamiNBC0C+YzewMI2hGpdkGC1DikbkPbHKNgeyLHCYduAj7rhjKsuhSeRFHvgqYGF6yfLNX6/M3rEnOFOHuVOH7yvI/eqC5bHM5PAv/w9zkFqn1Se5uQHNf7bgCRfhfwpRiLrfzlyQlVCpuEQuD9r+aDoShU9nA2Iw6LA==</base64EncryptedElementSignature>
</data>`,
      two: `<data id="encrypted" version="working3" encrypted="yes" xmlns="http://www.opendatakit.org/xforms/encrypted">
  <base64EncryptedKey>iyEB1LAlvVE8uaW0HuhLhzwcLceIukqfgusDNdDEE2FFxVtUtSI3FiOuNxhgI/Zbgnaabh/vqeZ3yLXwv0f66pAbN0n8kM9f84VJR18fdUp6doOz7o8IQD7gc3ZfbRXweab/NxnahfYa9ij0Kax1LTKS05Oodk2MewkzwfBhdbf/CfiBP1HSskDio40jdW5f04GkqZsFCPUluF2DfMnwYCo0wdwf2m8o+lSNR+vrFeEYG7LtGE4X90pVrQnJHwFWHGjSwJpg/USn5skBioDKUCv/Dva9xJ+JXUz+QSg6LOuP+SDxsrmf36WKrnE8kWfN4oaBdmIwFSStkLH9foNXUw==</base64EncryptedKey>
  <orx:meta xmlns:orx="http://openrosa.org/xforms"><orx:instanceID>uuid:99b303d9-6494-477b-a30d-d8aae8867335</orx:instanceID></orx:meta>
  <media><file>1561432532482.jpg.enc</file></media>
  <encryptedXmlFile>submission.xml.enc</encryptedXmlFile>
  <base64EncryptedElementSignature>a5A29xMc/7Aas1q1EpxJ/+D8dXsK3I6s9SVyzZRl6+2bILpHvPzG6LuFgTf6SM06Tnr13VNioNJLiTxvxna/nPHak015VSg4TWNvXcDpIbkDNS/2v6BZYv86zrao2DpG2lM9h8oPKy1vbHFcponu1/WVtEgZA/TzNMleJCMKCKQqDxt+n6og1QmWF4LBtsPaGB23ucvziQ57Yp8p+sVvqxs2OrJFYHGJReetqmbIUbyS4xvn3BJQa6BSiNMP35mFSvbLL+sCDSx/PiTTgtJ/oMUP+tqsR376l1TWXQhRHHFsCpwQQeS8GkhjEE6GD1XYscy5ATFv8W0cy2Y6GfN1jA==</base64EncryptedElementSignature>
</data>`
    },
    clientAudits: {
      one: '<data id="audits"><meta><instanceID>one</instanceID><audit>audit.csv</audit></meta><name>Alice</name><age>30</age></data>',
      two: '<data id="audits"><meta><instanceID>two</instanceID><audit>log.csv</audit></meta><name>Bob</name><age>34</age></data>'
    },
    selectMultiple: {
      one: instance('selectMultiple', 'one', '<q1>a b</q1><g1><q2>x y z</q2>'),
      two: instance('selectMultiple', 'two', '<q1>b</q1><g1><q2>m x</q2>'),
      three: instance('selectMultiple', 'three', '<q1> b c</q1>')
    },
    simpleEntity: {
      one: `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="simpleEntity" version="1.0">
              <meta>
                <instanceID>one</instanceID>
                <entities:entity dataset="people" id="uuid:12345678-1234-4123-8234-123456789abc" create="1">
                  <entities:label>Alice (88)</entities:label>
                </entities:entity>
                <orx:instanceName>one</orx:instanceName>
              </meta>
              <name>Alice</name>
              <age>88</age>
              <hometown>Chicago</hometown>
            </data>`,
      two: `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="simpleEntity" version="1.0">
              <meta>
                <instanceID>two</instanceID>
                <entities:entity dataset="people" id="uuid:12345678-1234-4123-8234-123456789aaa" create="1">
                  <entities:label>Jane (30)</entities:label>
                </entities:entity>
                <orx:instanceName>two</orx:instanceName>
              </meta>
              <name>Jane</name>
              <age>30</age>
              <hometown>Boston</hometown>
            </data>`,
      three: `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="simpleEntity" version="1.0">
          <meta>
            <instanceID>three</instanceID>
            <entities:entity dataset="people" id="uuid:12345678-1234-4123-8234-123456789bbb" create="1">
              <entities:label>John (40)</entities:label>
            </entities:entity>
            <orx:instanceName>three</orx:instanceName>
          </meta>
          <name>John</name>
          <age>40</age>
          <hometown>Toronto</hometown>
        </data>`,
      four: `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="simpleEntity" version="1.0">
          <meta>
            <instanceID>four</instanceID>
            <entities:entity dataset="people" id="uuid:12345678-1234-4123-8234-123456789ccc" create="1">
              <entities:label>Robert (18)</entities:label>
            </entities:entity>
            <orx:instanceName>four</orx:instanceName>
          </meta>
          <name>Robert</name>
          <age>18</age>
          <hometown>Seattle</hometown>
        </data>`
    },
    multiPropertyEntity: {
      one: `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="multiPropertyEntity" version="1.0">
        <meta>
          <instanceID>one</instanceID>
          <entities:entity dataset="foo" id="uuid:12345678-1234-4123-8234-123456789aaa" create="1">
            <entities:label>one</entities:label>
          </entities:entity>
        </meta>
        <q1>w</q1>
        <q2>x</q2>
        <q3>y</q3>
        <q4>z</q4>
      </data>`,
      two: `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="multiPropertyEntity" version="1.0">
        <meta>
          <instanceID>two</instanceID>
          <entities:entity dataset="foo" id="uuid:12345678-1234-4123-8234-123456789bbb" create="1">
            <entities:label>two</entities:label>
          </entities:entity>
        </meta>
        <q1>a</q1>
        <q2>b</q2>
        <q3>c</q3>
        <q4>d</q4>
      </data>`,
    },
    updateEntity: {
      one: `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="updateEntity" version="1.0">
        <meta>
          <instanceID>one</instanceID>
          <orx:instanceName>one</orx:instanceName>
          <entity dataset="people" id="12345678-1234-4123-8234-123456789abc" baseVersion="1" update="1">
            <label>Alicia (85)</label>
          </entity>
        </meta>
        <name>Alicia</name>
        <age>85</age>
      </data>`,
      two: `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="updateEntity" version="1.0">
        <meta>
          <instanceID>two</instanceID>
          <orx:instanceName>two</orx:instanceName>
          <entity dataset="people" id="12345678-1234-4123-8234-123456789abc" baseVersion="1" update="1">
            <label>Alicia - 85</label>
          </entity>
        </meta>
      </data>`,
      three: `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="updateEntity" version="1.0">
        <meta>
          <instanceID>three</instanceID>
          <orx:instanceName>three</orx:instanceName>
          <entity dataset="people" id="12345678-1234-4123-8234-123456789abc" baseVersion="1" update="1">
          </entity>
        </meta>
        <age>55</age>
      </data>`
    },
    offlineEntity: {
      one: `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="offlineEntity" version="1.0">
        <meta>
          <instanceID>one</instanceID>
          <orx:instanceName>one</orx:instanceName>
          <entity dataset="people" id="12345678-1234-4123-8234-123456789abc"
            baseVersion="1" update="1"
            trunkVersion="1" branchId="">
          </entity>
        </meta>
        <status>arrived</status>
      </data>`,
      two: `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms" id="offlineEntity" version="1.0">
        <meta>
          <instanceID>two</instanceID>
          <orx:instanceName>two</orx:instanceName>
          <entity dataset="people" id="12345678-1234-4123-8234-123456789ddd"
          baseVersion="" create="1"
          trunkVersion="" branchId="">
            <label>Megan (20)</label>
          </entity>
        </meta>
        <name>Megan</name>
        <status>new</status>
        <age>20</age>
      </data>`,
    },
    repeatEntityTrees: {
      one: `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" id="repeatEntityTrees" version="1">
      <plot_id>1</plot_id>
      <tree>
        <species>pine</species>
        <circumference>12</circumference>
        <meta>
          <entity dataset="trees" create="1" id="f73ea0a0-f51f-4d13-a7cb-c2123ba06f34">
            <label>Pine</label>
          </entity>
        </meta>
      </tree>
      <tree>
        <species>oak</species>
        <circumference>13</circumference>
        <meta>
          <entity dataset="trees" create="1" id="090c56ff-25f4-4503-b760-f6bef8528152">
            <label>Oak</label>
          </entity>
        </meta>
      </tree>
      <meta>
        <instanceID>one</instanceID>
      </meta>
    </data>`,
      two: `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" id="repeatEntityTrees" version="1">
      <plot_id>1</plot_id>
      <tree>
        <circumference>13</circumference>
        <meta>
          <entity dataset="trees" update="1" id="f73ea0a0-f51f-4d13-a7cb-c2123ba06f34" baseVersion="1" trunkVersion="" branchId="">
            <label>Pine - Updated</label>
          </entity>
        </meta>
      </tree>
      <tree>
        <species>chestnut</species>
        <circumference>22</circumference>
        <meta>
          <entity dataset="trees" create="1" id="f50cdbaf-95af-499c-a3e5-d0aea64248d9">
            <label>Chestnut</label>
          </entity>
        </meta>
      </tree>
      <meta>
        <instanceID>two</instanceID>
      </meta>
    </data>`
    },
    repeatEntityHousehold: {
      one: `<data
        xmlns:jr="http://openrosa.org/javarosa"
        xmlns:orx="http://openrosa.org/xforms" id="repeatEntityHousehold" version="2">
      <household_id>1</household_id>
      <members>
        <num_people>3</num_people>
        <person>
          <name>parent1</name>
          <age>35</age>
          <meta>
            <entity dataset="people" create="1" id="04f22514-654d-46e6-9d94-41676a5c97e1">
              <label>parent1</label>
            </entity>
          </meta>
        </person>
        <person>
          <name>parent2</name>
          <age>37</age>
          <meta>
            <entity dataset="people" id="3b082d6c-dcc8-4d42-9fe3-a4e4e5f1bb0a" create="1">
              <label>parent2</label>
            </entity>
          </meta>
        </person>
        <person>
          <name>child1</name>
          <age>12</age>
          <meta>
            <entity dataset="people" id="33bc1b45-ab0e-4652-abcf-90926b6dc0a3"  create="1">
              <label>child1</label>
            </entity>
          </meta>
        </person>
      </members>
      <meta>
        <instanceID>one</instanceID>
        <entity dataset="households" id="bdee1a6e-060c-47b7-9436-19296b0ded04" create="1">
          <label>Household:1</label>
        </entity>
      </meta>
    </data>`
    },
    multiEntityFarm: {
      one: `<data
        xmlns:jr="http://openrosa.org/javarosa"
        xmlns:orx="http://openrosa.org/xforms" id="multiEntityFarm" version="2">
      <farm>
        <farm_id>123</farm_id>
        <location>36.999194 -121.333626 0 0</location>
        <acres>30</acres>
        <farmer>
          <farmer_name>Barb</farmer_name>
          <age>53</age>
          <meta>
            <entity dataset="farmers" id="fcdb2759-69ef-4b47-b7fd-75170d326c80" create="1">
              <label>Farmer Barb</label>
            </entity>
          </meta>
        </farmer>
        <meta>
          <entity dataset="farms" id="94ca23e4-6050-4699-97cc-2588ca6c1a0e" create="1">
            <label>Farm 123</label>
          </entity>
        </meta>
      </farm>
      <meta>
        <instanceID>uuid:fccb4433-27cc-487c-9d4c-98786a20c5b6</instanceID>
        <instanceName>Farm 123-Barb</instanceName>
      </meta>
    </data>`
    },
    nestedRepeatEntity: {
      one: `<data
    xmlns:jr="http://openrosa.org/javarosa"
    xmlns:orx="http://openrosa.org/xforms" id="nestedRepeatEntity" version="20250915105318">
    <plot>
      <plot_id>123</plot_id>
      <crop>cherries</crop>
      <tree>
        <species>bing</species>
        <health_status>good</health_status>
        <meta>
          <entity dataset="trees" id="a09128f6-9a27-4f17-983e-9a44d4f906a4" create="1">
            <label>Tree bing</label>
          </entity>
        </meta>
      </tree>
      <tree>
        <species>rainier</species>
        <health_status>ok</health_status>
        <meta>
          <entity dataset="trees" id="dff8c2ac-df7f-46f6-81b7-e6ec698e036a" create="1">
            <label>Tree rainier</label>
          </entity>
        </meta>
      </tree>
      <meta>
        <entity dataset="plots" id="4989736e-b971-4996-b255-38578b47d734" create="1">
          <label>Plot 123: cherries</label>
        </entity>
      </meta>
    </plot>
    <plot>
      <plot_id>333</plot_id>
      <crop>apples</crop>
      <tree>
        <species>gala</species>
        <health_status>ok</health_status>
        <meta>
          <entity dataset="trees" id="06b601a3-f7e0-402d-9892-ed01d066eec1" create="1">
            <label>Tree gala</label>
          </entity>
        </meta>
      </tree>
      <tree>
        <species>pink lady</species>
        <health_status>good</health_status>
        <meta>
          <entity dataset="trees" id="d7dc7e20-5bf9-4e00-a2fa-cd3043eb546b" create="1">
            <label>Tree pink lady</label>
          </entity>
        </meta>
      </tree>
      <meta>
        <entity dataset="plots" id="22f5831e-5b1b-4faa-8a9d-02bafe3fde70" create="1">
          <label>Plot 333: apples</label>
        </entity>
      </meta>
    </plot>
    <meta>
      <instanceID>one</instanceID>
    </meta>
</data>`
    },
    groupRepeatEntity: {
      one: `<data
    xmlns:jr="http://openrosa.org/javarosa"
    xmlns:orx="http://openrosa.org/xforms" id="groupRepeatEntity" version="20250917095610">
    <tree>
      <tree_id>222</tree_id>
      <tree_details>
        <species>fig</species>
        <health_status>good</health_status>
        <meta>
          <entity dataset="trees" id="10e2ea24-0370-47df-85ee-b41010344cb8" create="1">
            <label>Tree fig</label>
          </entity>
        </meta>
      </tree_details>
    </tree>
    <tree>
      <tree_id>444</tree_id>
      <tree_details>
        <species>kumquat</species>
        <health_status>ok</health_status>
        <meta>
          <entity dataset="trees" id="8c4ada62-d76d-433b-80ce-a8c7f2a68d4b" create="1">
            <label>Tree kumquat</label>
          </entity>
        </meta>
      </tree_details>
    </tree>
    <meta>
      <instanceID>uuid:ace07f85-a5d5-4660-88b5-98286d833772</instanceID>
    </meta>
  </data>`
    },
    groupRepeat: {
      one: `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" id="groupRepeat">
      <text>xyz</text>
      <child_repeat>
        <name>John</name>
        <address>
          <city>Toronto</city>
          <country>Canada</country>
        </address>
      </child_repeat>
      <child_repeat>
        <name>Jane</name>
        <address>
          <city>New York</city>
          <country>US</country>
        </address>
      </child_repeat>
      <meta>
        <instanceID>uuid:2be07915-2c9c-401a-93ea-1c8f3f8e68f6</instanceID>
      </meta>
    </data>`
    },
    nestedGroup: {
      one: `<data xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" id="nestedGroup">
      <text>xyz</text>
      <hospital>
        <name>AKUH</name>
        <hiv_medication>
          <have_hiv_medication>Yes</have_hiv_medication>
        </hiv_medication>
      </hospital>
      <meta>
        <instanceID>uuid:f7908274-ef70-4169-90a0-e1389ab732ff</instanceID>
      </meta>
    </data>`
    }
  }
};

