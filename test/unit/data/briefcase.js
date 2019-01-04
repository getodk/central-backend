const appRoot = require('app-root-path');
const should = require('should');
const streamTest = require('streamtest').v2;
const { zipStreamToFiles } = require(appRoot + '/test/util/zip');
const { getFormSchema } = require(appRoot + '/lib/data/schema');
const { streamBriefcaseCsvs } = require(appRoot + '/lib/data/briefcase');
const { zipStreamFromParts } = require(appRoot + '/lib/util/zip');


// these are a little closer to integration tests than unit tests, by virtue of
// the complexity of recursive in-zip csv file generation. hard to test unitly.

// takes care of instance envelope boilerplate.
const instance = (id, data) => ({
  instanceId: id,
  createdAt: new Date('2018-01-01T00:00:00Z'),
  xml: `<data id="data">${data}</data>`
});

const withSubmitter = (id, displayName, row) => ({ submitter: { id, displayName }, ...row });

const callAndParse = (form, inStream, callback) =>
  streamBriefcaseCsvs(inStream, form).then((csvStream) =>
    zipStreamToFiles(zipStreamFromParts(csvStream), callback));

const mockForm = (data) => {
  data.schema = function() { return getFormSchema(this); };
  return data;
};

describe('.csv.zip briefcase output @slow', () => {
  it('should output a simple flat table within a zip', (done) => {
    const form = mockForm({
      xmlFormId: 'mytestform',
      xml: `
        <?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
          <h:head>
            <model>
              <instance>
                <data id="mytestform">
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
        </h:html>`
    });
    const inStream = streamTest.fromObjects([
      instance('one', '<name>Alice</name><age>30</age><hometown>Seattle, WA</hometown>'),
      instance('two', '<name>Bob</name><age>34</age><hometown>Portland, OR</hometown>'),
      instance('three', '<name>Chelsea</name><age>38</age><hometown>San Francisco, CA</hometown>')
    ]);

    callAndParse(form, inStream, (result) => {
      result.filenames.should.eql([ 'mytestform.csv' ]);
      result['mytestform.csv'].should.equal(
`SubmissionDate,name,age,hometown,KEY,SubmitterID,SubmitterName
2018-01-01T00:00:00.000Z,Alice,30,"Seattle, WA",one
2018-01-01T00:00:00.000Z,Bob,34,"Portland, OR",two
2018-01-01T00:00:00.000Z,Chelsea,38,"San Francisco, CA",three
`);
      done();
    });
  });

  it('should attach submitter information if present', (done) => {
    const form = mockForm({
      xmlFormId: 'mytestform',
      xml: `
        <?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
          <h:head>
            <model>
              <instance>
                <data id="mytestform">
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
        </h:html>`
    });
    const inStream = streamTest.fromObjects([
      withSubmitter(4, 'daniela', instance('one', '<name>Alice</name><age>30</age><hometown>Seattle, WA</hometown>')),
      withSubmitter(8, 'hernando', instance('two', '<name>Bob</name><age>34</age><hometown>Portland, OR</hometown>')),
      withSubmitter(15, 'lito', instance('three', '<name>Chelsea</name><age>38</age><hometown>San Francisco, CA</hometown>'))
    ]);

    callAndParse(form, inStream, (result) => {
      result.filenames.should.eql([ 'mytestform.csv' ]);
      result['mytestform.csv'].should.equal(
`SubmissionDate,name,age,hometown,KEY,SubmitterID,SubmitterName
2018-01-01T00:00:00.000Z,Alice,30,"Seattle, WA",one,4,daniela
2018-01-01T00:00:00.000Z,Bob,34,"Portland, OR",two,8,hernando
2018-01-01T00:00:00.000Z,Chelsea,38,"San Francisco, CA",three,15,lito
`);
      done();
    });
  });

  it('should decode xml entities for output', (done) => {
    const form = mockForm({
      xmlFormId: 'mytestform',
      xml: `
        <?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
          <h:head>
            <model>
              <instance>
                <data id="mytestform">
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
        </h:html>`
    });
    const inStream = streamTest.fromObjects([
      instance('one', '<name>&#171;Alice&#187;</name><age>30</age><hometown>Seattle, WA</hometown>'),
    ]);

    callAndParse(form, inStream, (result) => {
      result.filenames.should.eql([ 'mytestform.csv' ]);
      result['mytestform.csv'].should.equal(
`SubmissionDate,name,age,hometown,KEY,SubmitterID,SubmitterName
2018-01-01T00:00:00.000Z,\xABAlice\xBB,30,"Seattle, WA",one
`);
      done();
    });
  });

  it('should split geopoint columns into four components', (done) => {
    const form = mockForm({
      xmlFormId: 'mytestform',
      xml: `
        <?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
          <h:head>
            <model>
              <instance>
                <data id="mytestform">
                  <name/>
                  <age/>
                  <location/>
                </data>
              </instance>
              <bind nodeset="/data/name" type="string"/>
              <bind type="integer" nodeset="/data/age"/>
              <bind nodeset="/data/location" type="geopoint"/>
            </model>
          </h:head>
        </h:html>`
    });
    const inStream = streamTest.fromObjects([
      instance('one', '<name>Alice</name><age>30</age><location>47.649434 -122.347737 26.8 3.14</location>'),
      instance('two', '<name>Bob</name><age>34</age><location>47.599115 -122.331753 10</location>'),
      instance('three', '<name>Chelsea</name><age>38</age><location></location>')
    ]);

    callAndParse(form, inStream, (result) => {
      result.filenames.should.eql([ 'mytestform.csv' ]);
      result['mytestform.csv'].should.equal(
`SubmissionDate,name,age,location-Latitude,location-Longitude,location-Altitude,location-Accuracy,KEY,SubmitterID,SubmitterName
2018-01-01T00:00:00.000Z,Alice,30,47.649434,-122.347737,26.8,3.14,one
2018-01-01T00:00:00.000Z,Bob,34,47.599115,-122.331753,10,,two
2018-01-01T00:00:00.000Z,Chelsea,38,,,,,three
`);
      done();
    });
  });

  it('should flatten structures within a table', (done) => {
    const form = mockForm({
      xmlFormId: 'structuredform',
      xml: `
        <?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
          <h:head>
            <model>
              <instance>
                <data id="structuredform">
                  <orx:meta>
                    <orx:instanceID/>
                  </orx:meta>
                  <name/>
                  <home>
                    <type/>
                    <address>
                      <street/>
                      <city/>
                    </address>
                  </home>
                </data>
              </instance>
              <bind nodeset="/data/orx:meta/orx:instanceID" preload="uid" type="string"/>
              <bind nodeset="/data/name" type="string"/>
              <bind nodeset="/data/home/type" type="select1"/>
              <bind nodeset="/data/home/address/street" type="string"/>
              <bind nodeset="/data/home/address/city" type="string"/>
            </model>
          </h:head>
        </h:html>`
    });
    const inStream = streamTest.fromObjects([
      instance('one', '<orx:meta><orx:instanceID>one</orx:instanceID></orx:meta><name>Alice</name><home><type>Apartment</type><address><street>101 Pike St</street><city>Seattle, WA</city></address></home>'),
      instance('two', '<orx:meta><orx:instanceID>two</orx:instanceID></orx:meta><name>Bob</name><home><address><street>20 Broadway</street><city>Portland, OR</city></address><type>Condo</type></home>'),
      instance('three', '<orx:meta><orx:instanceID>three</orx:instanceID></orx:meta><name>Chelsea</name><home><type>House</type><address><city>San Francisco, CA</city><street>99 Mission Ave</street></address></home>'),
    ]);

    callAndParse(form, inStream, (result) => {
      result.filenames.should.eql([ 'structuredform.csv' ]);
      result['structuredform.csv'].should.equal(
`SubmissionDate,meta-instanceID,name,home-type,home-address-street,home-address-city,KEY,SubmitterID,SubmitterName
2018-01-01T00:00:00.000Z,one,Alice,Apartment,101 Pike St,"Seattle, WA",one
2018-01-01T00:00:00.000Z,two,Bob,Condo,20 Broadway,"Portland, OR",two
2018-01-01T00:00:00.000Z,three,Chelsea,House,99 Mission Ave,"San Francisco, CA",three
`);
      done();
    });
  });

  it('should handle single-level repeats, with KEY/PARENT_KEY', (done) => {
    const form = mockForm({
      xmlFormId: 'singlerepeat',
      xml: `
        <?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
          <h:head>
            <model>
              <instance>
                <data id="singlerepeat">
                  <orx:meta>
                    <orx:instanceID/>
                  </orx:meta>
                  <name/>
                  <age/>
                  <children>
                    <child>
                      <name/>
                      <age/>
                    </child>
                  </children>
                </data>
              </instance>
              <bind nodeset="/data/orx:meta/orx:instanceID" preload="uid" type="string"/>
              <bind nodeset="/data/name" type="string"/>
              <bind nodeset="/data/age" type="integer"/>
              <bind nodeset="/data/children/child/name" type="string"/>
              <bind nodeset="/data/children/child/age" type="integer"/>
            </model>
          </h:head>
          <h:body>
            <input ref="/data/name">
              <label>What is your name?</label>
            </input>
            <input ref="/data/age">
              <label>What is your age?</label>
            </input>
            <group ref="/data/children">
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
        </h:html>`
    });
    const inStream = streamTest.fromObjects([
      instance('one', '<orx:meta><orx:instanceID>one</orx:instanceID></orx:meta><name>Alice</name><age>30</age>'),
      instance('two', '<orx:meta><orx:instanceID>two</orx:instanceID></orx:meta><name>Bob</name><age>34</age><children><child><name>Billy</name><age>4</age></child></children><children><child><name>Blaine</name><age>6</age></child></children>'),
      instance('three', '<orx:meta><orx:instanceID>three</orx:instanceID></orx:meta><name>Chelsea</name><age>38</age><children><child><name>Candace</name><age>2</age></child></children>'),
    ]);

    callAndParse(form, inStream, (result) => {
      result.filenames.should.containDeep([ 'singlerepeat.csv', 'singlerepeat-child.csv' ]);
      result['singlerepeat.csv'].should.equal(
`SubmissionDate,meta-instanceID,name,age,KEY,SubmitterID,SubmitterName
2018-01-01T00:00:00.000Z,one,Alice,30,one
2018-01-01T00:00:00.000Z,two,Bob,34,two
2018-01-01T00:00:00.000Z,three,Chelsea,38,three
`);
      result['singlerepeat-child.csv'].should.equal(
`name,age,PARENT_KEY,KEY
Billy,4,two,two/children/child[1]
Blaine,6,two,two/children/child[2]
Candace,2,three,three/children/child[1]
`);
      done();
    });
  });

  it('should handle nested repeats, with PARENT_KEY/KEY', (done) => {
    const form = mockForm({
      xmlFormId: 'multirepeat',
      xml: `
        <?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
          <h:head>
            <model>
              <instance>
                <data id="multirepeat">
                  <orx:meta>
                    <orx:instanceID/>
                  </orx:meta>
                  <name/>
                  <age/>
                  <children>
                    <child>
                      <name/>
                      <age/>
                      <toy>
                        <name/>
                      </toy>
                    </child>
                  </children>
                </data>
              </instance>
              <bind nodeset="/data/meta/instanceID" preload="uid" type="string"/>
              <bind nodeset="/data/name" type="string"/>
              <bind nodeset="/data/age" type="integer"/>
              <bind nodeset="/data/children/child/name" type="string"/>
              <bind nodeset="/data/children/child/age" type="integer"/>
              <bind nodeset="/data/children/child/toy/name" type="string"/>
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
        </h:html>`
    });
    const inStream = streamTest.fromObjects([
      instance('one', '<orx:meta><orx:instanceID>one</orx:instanceID></orx:meta><name>Alice</name><age>30</age>'),
      instance('two', '<orx:meta><orx:instanceID>two</orx:instanceID></orx:meta><name>Bob</name><age>34</age><children><child><name>Billy</name><age>4</age><toy><name>R2-D2</name></toy></child><child><name>Blaine</name><age>6</age><toy><name>BB-8</name></toy><toy><name>Porg plushie</name></toy></child><child><name>Baker</name><age>7</age></child></children>'),
      instance('three', '<orx:meta><orx:instanceID>three</orx:instanceID></orx:meta><name>Chelsea</name><age>38</age><children><child><name>Candace</name><toy><name>Millennium Falcon</name></toy><toy><name>X-Wing</name></toy><toy><name>Pod racer</name></toy><age>2</age></child></children>'),
    ]);

    callAndParse(form, inStream, (result) => {
      result.filenames.should.containDeep([ 'multirepeat.csv', 'multirepeat-child.csv', 'multirepeat-toy.csv' ]);
      result['multirepeat.csv'].should.equal(
`SubmissionDate,meta-instanceID,name,age,KEY,SubmitterID,SubmitterName
2018-01-01T00:00:00.000Z,one,Alice,30,one
2018-01-01T00:00:00.000Z,two,Bob,34,two
2018-01-01T00:00:00.000Z,three,Chelsea,38,three
`);
      result['multirepeat-child.csv'].should.equal(
`name,age,PARENT_KEY,KEY
Billy,4,two,two/children/child[1]
Blaine,6,two,two/children/child[2]
Baker,7,two,two/children/child[3]
Candace,2,three,three/children/child[1]
`);
      result['multirepeat-toy.csv'].should.equal(
`name,PARENT_KEY,KEY
R2-D2,two/children/child[1],two/children/child[1]/toy[1]
BB-8,two/children/child[2],two/children/child[2]/toy[1]
Porg plushie,two/children/child[2],two/children/child[2]/toy[2]
Millennium Falcon,three/children/child[1],three/children/child[1]/toy[1]
X-Wing,three/children/child[1],three/children/child[1]/toy[2]
Pod racer,three/children/child[1],three/children/child[1]/toy[3]
`);
      done();
    });
  });

  it('briefcase replicated test: all-data-types', (done) => {
    const form = mockForm({
      xmlFormId: 'all-data-types',
      xml: `
<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml">
  <h:head>
    <h:title>All data types</h:title>
    <model>
      <instance>
        <data id="all-data-types">
          <some_string/>
          <some_int/>
          <some_decimal/>
          <some_date/>
          <some_time/>
          <some_date_time/>
          <some_geopoint/>
          <some_geotrace/>
          <some_geoshape/>
          <some_barcode/>
          <meta>
            <instanceID/>
          </meta>
        </data>
      </instance>
      <bind nodeset="/data/some_string" type="string"/>
      <bind nodeset="/data/some_int" type="int"/>
      <bind nodeset="/data/some_decimal" type="decimal"/>
      <bind nodeset="/data/some_date" type="date"/>
      <bind nodeset="/data/some_time" type="time"/>
      <bind nodeset="/data/some_date_time" type="dateTime"/>
      <bind nodeset="/data/some_geopoint" type="geopoint"/>
      <bind nodeset="/data/some_geotrace" type="geotrace"/>
      <bind nodeset="/data/some_geoshape" type="geoshape"/>
      <bind nodeset="/data/some_barcode" type="barcode"/>
      <bind calculate="concat('uuid:', uuid())" nodeset="/data/meta/instanceID" readonly="true()" type="string"/>
    </model>
  </h:head>
  <h:body>
    <input ref="some_string"/>
    <input ref="some_int"/>
    <input ref="some_decimal"/>
    <input ref="some_date"/>
    <input ref="some_time"/>
    <input ref="some_date_time"/>
    <input ref="some_geopoint"/>
    <input ref="some_geotrace"/>
    <input ref="some_geoshape"/>
    <input ref="some_barcode"/>
  </h:body>
</h:html>`
    });
    const inStream = streamTest.fromObjects([{
      instanceId: 'uuid:39f3dd36-161e-45cb-a1a4-395831d253a7',
      createdAt: '2018-04-26T08:58:20.525Z',
      xml: `
<data id="all-data-types" instanceID="uuid:39f3dd36-161e-45cb-a1a4-395831d253a7" submissionDate="2018-04-26T08:58:20.525Z" isComplete="true" markedAsCompleteDate="2018-04-26T08:58:20.525Z" xmlns="http://opendatakit.org/submissions">
  <some_string>Hola</some_string>
  <some_int>123</some_int>
  <some_decimal>123.456</some_decimal>
  <some_date>2018-04-26</some_date>
  <some_time>08:56:00.000Z</some_time>
  <some_date_time>2018-04-26T08:56:00.000Z</some_date_time>
  <some_geopoint>43.3149254 -1.9869671 71.80000305175781 15.478</some_geopoint>
  <some_geotrace>43.314926 -1.9869713 71.80000305175781 10.0;43.3149258 -1.9869694 71.80000305175781 10.0;43.3149258 -1.9869694 71.80000305175781 10.0;</some_geotrace>
  <some_geoshape>43.31513313655808 -1.9863833114504814 0.0 0.0;43.31552832470026 -1.987161487340927 0.0 0.0;43.315044828733015 -1.9877894595265388 0.0 0.0;43.31459255404834 -1.9869402050971987 0.0 0.0;43.31513313655808 -1.9863833114504814 0.0 0.0;</some_geoshape>
  <some_barcode>000049499094</some_barcode>
  <n0:meta xmlns:n0="http://openrosa.org/xforms">
    <n0:instanceID>uuid:39f3dd36-161e-45cb-a1a4-395831d253a7</n0:instanceID>
  </n0:meta>
</data>`
    }]);

    callAndParse(form, inStream, (result) => {
      result.filenames.should.containDeep([ 'all-data-types.csv' ]);
      result['all-data-types.csv'].should.equal(
`SubmissionDate,some_string,some_int,some_decimal,some_date,some_time,some_date_time,some_geopoint-Latitude,some_geopoint-Longitude,some_geopoint-Altitude,some_geopoint-Accuracy,some_geotrace,some_geoshape,some_barcode,meta-instanceID,KEY,SubmitterID,SubmitterName
2018-04-26T08:58:20.525Z,Hola,123,123.456,2018-04-26,08:56:00.000Z,2018-04-26T08:56:00.000Z,43.3149254,-1.9869671,71.80000305175781,15.478,43.314926 -1.9869713 71.80000305175781 10.0;43.3149258 -1.9869694 71.80000305175781 10.0;43.3149258 -1.9869694 71.80000305175781 10.0;,43.31513313655808 -1.9863833114504814 0.0 0.0;43.31552832470026 -1.987161487340927 0.0 0.0;43.315044828733015 -1.9877894595265388 0.0 0.0;43.31459255404834 -1.9869402050971987 0.0 0.0;43.31513313655808 -1.9863833114504814 0.0 0.0;,000049499094,uuid:39f3dd36-161e-45cb-a1a4-395831d253a7,uuid:39f3dd36-161e-45cb-a1a4-395831d253a7
`);
      done();
    });
  });

  it('briefcase replicated test: nested-repeats', (done) => {
    const form = mockForm({
      xmlFormId: 'nested-repeats',
      xml: `
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <h:title>Nested repeats</h:title>
    <model>
      <instance>
        <data id="nested-repeats">
          <meta>
            <instanceID/>
          </meta>
          <g1 jr:template="">
            <t1/>
            <g2 jr:template="">
              <t2/>
              <g3 jr:template="">
                <t3/>
              </g3>
            </g2>
          </g1>
        </data>
      </instance>
      <itext>
        <translation lang="English">
          <text id="/data/g1:label">
            <value></value>
          </text>
          <text id="/data/g1/g2:label">
            <value></value>
          </text>
          <text id="/data/g1/g2/g3:label">
            <value></value>
          </text>
        </translation>
      </itext>
      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
      <bind nodeset="/data/g1/t1" type="string"/>
      <bind nodeset="/data/g1/g2/t2" type="string"/>
      <bind nodeset="/data/g1/g2/g3/t3" type="string"/>
    </model>
  </h:head>
  <h:body>
    <group>
      <label ref="jr:itext('/data/g1:label')"/>
      <repeat nodeset="/data/g1">
        <input ref="/data/g1/t1">
        </input>
        <group>
          <label ref="jr:itext('/data/g1/g2:label')"/>
          <repeat nodeset="/data/g1/g2">
            <input ref="/data/g1/g2/t2">
            </input>
            <group>
              <label ref="jr:itext('/data/g1/g2/g3:label')"/>
              <repeat nodeset="/data/g1/g2/g3">
                <input ref="/data/g1/g2/g3/t3">
                </input>
              </repeat>
            </group>
          </repeat>
        </group>
      </repeat>
    </group>
  </h:body>
</h:html>`
    });
    const inStream = streamTest.fromObjects([{
      instanceId: 'uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b',
      createdAt: '2018-02-01T11:35:19.178Z',
      xml: `
<data id="nested-repeats" instanceID="uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b" version="2018012404" submissionDate="2018-02-01T11:35:19.178Z" isComplete="true" markedAsCompleteDate="2018-02-01T11:35:19.178Z" xmlns="http://opendatakit.org/submissions">
  <g1>
    <t1>some text 1</t1>
    <g2>
      <t2>some text 1.1</t2>
      <g3>
        <t3>some text 1.1.1</t3>
      </g3>
    </g2>
    <g2>
      <t2>some text 1.2</t2>
    </g2>
  </g1>

  <g1>
    <t1>some text 2</t1>
    <g2>
      <t2>some text 2.1</t2>
    </g2>
  </g1>

  <g1>
    <t1>some text 3</t1>
    <g2>
      <t2>some text 3.1</t2>
      <g3>
        <t3>some text 3.1.1</t3>
      </g3>
      <g3>
        <t3>some text 3.1.2</t3>
      </g3>
      <g3>
        <t3>some text 3.1.3</t3>
      </g3>
      <g3>
        <t3>some text 3.1.4</t3>
      </g3>
    </g2>
  </g1>
  <n0:meta xmlns:n0="http://openrosa.org/xforms">
    <n0:instanceID>uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b</n0:instanceID>
  </n0:meta>
</data>`
    }]);

    callAndParse(form, inStream, (result) => {
      result.filenames.should.containDeep([ 'nested-repeats.csv', 'nested-repeats-g1.csv', 'nested-repeats-g2.csv', 'nested-repeats-g3.csv' ]);
      result['nested-repeats.csv'].should.equal(
`SubmissionDate,meta-instanceID,KEY,SubmitterID,SubmitterName
2018-02-01T11:35:19.178Z,uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b,uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b
`);
      result['nested-repeats-g1.csv'].should.equal(
`t1,PARENT_KEY,KEY
some text 1,uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b,uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[1]
some text 2,uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b,uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[2]
some text 3,uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b,uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[3]
`);
      result['nested-repeats-g2.csv'].should.equal(
`t2,PARENT_KEY,KEY
some text 1.1,uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[1],uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[1]/g2[1]
some text 1.2,uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[1],uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[1]/g2[2]
some text 2.1,uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[2],uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[2]/g2[1]
some text 3.1,uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[3],uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[3]/g2[1]
`);
      result['nested-repeats-g3.csv'].should.equal(
`t3,PARENT_KEY,KEY
some text 1.1.1,uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[1]/g2[1],uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[1]/g2[1]/g3[1]
some text 3.1.1,uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[3]/g2[1],uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[3]/g2[1]/g3[1]
some text 3.1.2,uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[3]/g2[1],uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[3]/g2[1]/g3[2]
some text 3.1.3,uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[3]/g2[1],uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[3]/g2[1]/g3[3]
some text 3.1.4,uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[3]/g2[1],uuid:0a1b861f-a5fd-4f49-846a-78dcf06cfc1b/g1[3]/g2[1]/g3[4]
`);
      done();
    });
  });

  it('should disambiguate conflictingly named repeat groups', (done) => {
    const form = mockForm({
      xmlFormId: 'ambiguous',
      xml: `
        <?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
          <h:head>
            <model>
              <instance>
                <data id="ambiguous">
                  <orx:meta>
                    <orx:instanceID/>
                  </orx:meta>
                  <name/>
                  <jobs>
                    <entry><name/></entry>
                  </jobs>
                  <friends>
                    <entry><name/></entry>
                  </friends>
                </data>
              </instance>
              <bind nodeset="/data/meta/instanceID" preload="uid" type="string"/>
              <bind nodeset="/data/name" type="string"/>
              <bind nodeset="/data/jobs/entry/name" type="string"/>
              <bind nodeset="/data/friends/entry/name" type="string"/>
            </model>
          </h:head>
          <h:body>
            <input ref="/data/name">
              <label>What is your name?</label>
            </input>
            <group ref="/data/jobs/entry">
              <label>Job</label>
              <repeat nodeset="/data/jobs/entry">
                <input ref="/data/jobs/entry/name">
                  <label>What is the employer name?</label>
                </input>
              </repeat>
            </group>
            <group ref="/data/friends/entry">
              <label>Friend</label>
              <repeat nodeset="/data/friends/entry">
                <input ref="/data/friends/entry/name">
                  <label>What is the person's name?</label>
                </input>
              </repeat>
            </group>
          </h:body>
        </h:html>`
    });
    const inStream = streamTest.fromObjects([
      instance('one', '<orx:meta><orx:instanceID>one</orx:instanceID></orx:meta><name>Alice</name>'),
      instance('two', '<orx:meta><orx:instanceID>two</orx:instanceID></orx:meta><name>Bob</name><jobs><entry><name>Bobs Hardware</name></entry><entry><name>Local Coffee</name></entry></jobs><friends><entry><name>Nasrin</name></entry></friends>'),
      instance('three', '<orx:meta><orx:instanceID>three</orx:instanceID></orx:meta><name>Chelsea</name><jobs><entry><name>Instantaneous Food</name></entry></jobs><friends><entry><name>Ferrence</name></entry><entry><name>Mick</name></entry></friends>'),
    ]);

    callAndParse(form, inStream, (result) => {
      result.filenames.should.containDeep([ 'ambiguous.csv', 'ambiguous-entry~1.csv', 'ambiguous-entry~2.csv' ]);
      result['ambiguous.csv'].should.equal(
`SubmissionDate,meta-instanceID,name,KEY,SubmitterID,SubmitterName
2018-01-01T00:00:00.000Z,one,Alice,one
2018-01-01T00:00:00.000Z,two,Bob,two
2018-01-01T00:00:00.000Z,three,Chelsea,three
`);
      result['ambiguous-entry~1.csv'].should.equal(
`name,PARENT_KEY,KEY
Bobs Hardware,two,two/jobs/entry[1]
Local Coffee,two,two/jobs/entry[2]
Instantaneous Food,three,three/jobs/entry[1]
`);
      result['ambiguous-entry~2.csv'].should.equal(
`name,PARENT_KEY,KEY
Nasrin,two,two/friends/entry[1]
Ferrence,three,three/friends/entry[1]
Mick,three,three/friends/entry[2]
`);
      done();
    });
  });
});

