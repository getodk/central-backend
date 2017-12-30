const should = require('should');
const { open } = require('yauzl');
const streamTest = require('streamtest').v2;
const yauzl = require('yauzl');
const { streamDataZip } = require('../../../lib/data/csv');
const { createWriteStream } = require('fs');
const tmp = require('tmp');


// these are a little closer to integration tests than unit tests, by virtue of
// the complexity of recursive in-zip csv file generation. hard to test unitly.

// takes care of instance envelope boilerplate.
const instance = (id, data) => ({
  xml: `<submission><data><data id="data" instanceID="${id}">${data}</data></data></submission>`
});

// does all the plumbing work to call the streamer, then unzip and detangle the result.
// also, hooraaaayy callback hell.
// calls the callback with an object as follows:
// {
//      filenames: [ names of files in zip ],
//      {filename}: "contents",
//      {filename}: "contents",
//      …
// }
const callAndParse = (form, inStream, callback) => {
  tmp.file((_, tmpfile) => {
    const zipStream = streamDataZip(inStream, form);
    const writeStream = createWriteStream(tmpfile);
    zipStream.pipe(writeStream);
    zipStream.on('end', () => {
      yauzl.open(tmpfile, { autoClose: false }, (_, zipfile) => {
        const result = { filenames: [] };
        let entries = [];
        let completed = 0;

        zipfile.on('entry', (entry) => entries.push(entry));
        zipfile.on('end', () => {
          entries.forEach((entry) => {
            result.filenames.push(entry.fileName);
            zipfile.openReadStream(entry, (_, resultStream) => {
              resultStream.pipe(streamTest.toText((_, contents) => {
                result[entry.fileName] = contents;
                completed += 1;
                if (completed === entries.length) {
                  callback(result);
                  zipfile.close();
                }
              }));
            });
          });
        });
      });
    });
  });
};

describe('.csv.zip output', () => {
  it('should output a simple flat table within a zip', (done) => {
    const form = {
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
          <h:/head>
        <h:/html>`
    };
    const inStream = streamTest.fromObjects([
      instance('one', '<name>Alice</name><age>30</age><hometown>Seattle, WA</hometown>'),
      instance('two', '<name>Bob</name><age>34</age><hometown>Portland, OR</hometown>'),
      instance('three', '<name>Chelsea</name><age>38</age><hometown>San Francisco, CA</hometown>')
    ]);

    callAndParse(form, inStream, (result) => {
      result.filenames.should.eql([ 'mytestform.csv' ]);
      result['mytestform.csv'].should.equal(`name,age,hometown
Alice,30,"Seattle, WA"
Bob,34,"Portland, OR"
Chelsea,38,"San Francisco, CA"
`);
      done();
    });
  });
});

