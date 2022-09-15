const should = require('should');
const tmp = require('tmp');
const yauzl = require('yauzl');
const { createWriteStream } = require('fs');
const streamTest = require('streamtest').v2;

// does all the plumbing work to call the streamer, then unzip and detangle the result.
// also, hooraaaayy callback hell.
// calls the callback with an object as follows:
// {
//      filenames: [ names of files in zip ],
//      {filename}: "contents",
//      {filename}: "contents",
//      …
// }
const zipStreamToFiles = (zipStream, callback) => {
  tmp.file((_, tmpfile) => {
    const writeStream = createWriteStream(tmpfile);
    zipStream.pipe(writeStream);
    zipStream.on('end', () => {
      setTimeout(() => {
        yauzl.open(tmpfile, { autoClose: false }, (_, zipfile) => {
          const result = { filenames: [] };
          let entries = [];
          let completed = 0;

          should.exist(zipfile);
          zipfile.on('entry', (entry) => entries.push(entry));
          zipfile.on('end', () => {
            if (entries.length === 0) {
              callback(result);
              zipfile.close();
            } else {
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
            }
          });
        });
      }, 5); // otherwise sometimes the file doesn't fully drain
    });
  });
};

const pZipStreamToFiles = (zipStream) => new Promise((resolve) => zipStreamToFiles(zipStream, resolve));

module.exports = { zipStreamToFiles, pZipStreamToFiles };

