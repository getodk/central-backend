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

const callAndParse = (form, inStream, callback) =>
  zipStreamToFiles(zipStreamFromParts(streamBriefcaseCsvs(inStream, form)), callback);

const mockForm = (data) => {
  data.schema = function() { return getFormSchema(this); };
  return data;
};

describe('.csv.zip briefcase output', () => {
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
`SubmissionDate,name,age,hometown,KEY
2018-01-01T00:00:00.000Z,Alice,30,"Seattle, WA",one
2018-01-01T00:00:00.000Z,Bob,34,"Portland, OR",two
2018-01-01T00:00:00.000Z,Chelsea,38,"San Francisco, CA",three
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
`SubmissionDate,name,age,location-Latitude,location-Longitude,location-Altitude,location-Accuracy,KEY
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
              <bind nodeset="/data/meta/instanceID" preload="uid" type="string"/>
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
`SubmissionDate,meta-instanceID,name,home-type,home-address-street,home-address-city,KEY
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
              <bind nodeset="/data/meta/instanceID" preload="uid" type="string"/>
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
      result.filenames.should.containDeep([ 'singlerepeat.csv', 'singlerepeat-children-child.csv' ]);
      result['singlerepeat.csv'].should.equal(
`SubmissionDate,meta-instanceID,name,age,KEY
2018-01-01T00:00:00.000Z,one,Alice,30,one
2018-01-01T00:00:00.000Z,two,Bob,34,two
2018-01-01T00:00:00.000Z,three,Chelsea,38,three
`);
      result['singlerepeat-children-child.csv'].should.equal(
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
      result.filenames.should.containDeep([ 'multirepeat.csv', 'multirepeat-children-child.csv', 'multirepeat-children-child-toy.csv' ]);
      result['multirepeat.csv'].should.equal(
`SubmissionDate,meta-instanceID,name,age,KEY
2018-01-01T00:00:00.000Z,one,Alice,30,one
2018-01-01T00:00:00.000Z,two,Bob,34,two
2018-01-01T00:00:00.000Z,three,Chelsea,38,three
`);
      result['multirepeat-children-child.csv'].should.equal(
`name,age,PARENT_KEY,KEY
Billy,4,two,two/children/child[1]
Blaine,6,two,two/children/child[2]
Baker,7,two,two/children/child[3]
Candace,2,three,three/children/child[1]
`);
      result['multirepeat-children-child-toy.csv'].should.equal(
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
});


