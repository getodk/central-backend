const tmp = require('tmp');
const yauzl = require('yauzl');
const { createWriteStream } = require('fs');
const streamTest = require('streamtest').v2;

// unzip and detangle zipfiles.
// also, hooraaaayy callback hell.
// calls the callback with an object { filenames:[], files:Map(name -> contents) }
const processZipFile = (zipfile, callback) => {
  const result = { filenames: [], files: new Map() };
  const entries = [];
  let completed = 0;

  zipfile.on('error', (err) => callback(err));
  zipfile.on('entry', (entry) => entries.push(entry));
  zipfile.on('end', () => {
    if (entries.length === 0) {
      callback(null, result);
      zipfile.close();
    } else {
      entries.forEach((entry) => {
        result.filenames.push(entry.fileName);
        // eslint-disable-next-line no-shadow
        zipfile.openReadStream(entry, (err, resultStream) => {
          if (err) return callback(err);

          // eslint-disable-next-line no-shadow
          resultStream.pipe(streamTest.toText((err, contents) => {
            if (err) return callback(err);

            result.files.set(entry.fileName, contents);
            completed += 1;
            if (completed === entries.length) {
              callback(null, result);
              zipfile.close();
            }
          }));
        });
      });
    }
  });
};

const zipStreamToFiles = (zipStream, callback) => {
  tmp.file((err, tmpfile) => {
    if (err) return callback(err);

    const writeStream = createWriteStream(tmpfile);
    zipStream.pipe(writeStream);
    zipStream.on('end', () => {
      setTimeout(() => {
        // eslint-disable-next-line no-shadow
        yauzl.open(tmpfile, { autoClose: false }, (err, zipfile) => {
          if (err) return callback(err);
          processZipFile(zipfile, callback);
        });
      }, 5); // otherwise sometimes the file doesn't fully drain
    });
  });
};

// Work around a subtle bug in streams that is not fully understood.  Probably one of:
//
// * the cleanup code in test/util/zip.js, or
// * an unfulfilled interaction that supertest is expecting when working with streams, or
// * a bug in supertest's pipe/stream implementation
//
// Possibly: https://github.com/ladjs/supertest/issues/487
//
// Parsers are documented at:
//
// * https://github.com/ladjs/superagent/blob/master/docs/index.md#parsing-response-bodies
// * https://github.com/ladjs/superagent/tree/2fd631ae225f4335fef37e9888925db0ef42d497/src/node/parsers
//
// There doesn't seem to be an error event.
const binaryParser = (res, callback) => {
  res.setEncoding('binary');
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    callback(null, Buffer.from(data, 'binary'));
  });
};

const httpZipResponseToFiles = (zipHttpResponse) => new Promise((resolve, reject) => {
  zipHttpResponse
    .expect(200)
    .expect('Content-Type', 'application/zip')
    .buffer()
    .parse(binaryParser)
    .end((err, res) => {
      if (err) return reject(err);

      // eslint-disable-next-line no-shadow
      yauzl.fromBuffer(res.body, (err, zipfile) => {
        if (err) return reject(err);

        // eslint-disable-next-line no-shadow
        processZipFile(zipfile, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    });
});

module.exports = { zipStreamToFiles, httpZipResponseToFiles };
