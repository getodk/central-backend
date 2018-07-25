
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
</h:html>`
  },
  instances: {
    simple: {
      one: instance('simple', 'one', '<name>Alice</name><age>30</age>'),
      two: instance('simple', 'two', '<name>Bob</name><age>34</age>'),
      three: instance('simple', 'three', '<name>Chelsea</name><age>38</age>')
    },
    withrepeat: {
      one: fullInstance('withrepeat', '1.0', 'one', '<name>Alice</name><age>30</age>'),
      two: fullInstance('withrepeat', '1.0', 'two', '<name>Bob</name><age>34</age><children><child><name>Billy</name><age>4</age></child><child><name>Blaine</name><age>6</age></child></children>'),
      three: fullInstance('withrepeat', '1.0', 'three', '<name>Chelsea</name><age>38</age><children><child><name>Candace</name><age>2</age></child></children>'),
    },
    simple2: {
      one: instance('simple2', 'one', '<name>Alice</name><age>30</age>'),
      two: instance('simple2', 'two', '<name>Bob</name><age>34</age>'),
      three: instance('simple2', 'three', '<name>Chelsea</name><age>38</age>')
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
    }
  }
};

