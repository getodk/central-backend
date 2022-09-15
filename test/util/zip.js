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
  tmp.file((err, tmpfile) => {
    if(err) return callback(err);

    const writeStream = createWriteStream(tmpfile);
    zipStream.pipe(writeStream);
    zipStream.on('end', () => {
      setTimeout(() => {
        yauzl.open(tmpfile, { autoClose: false }, (err, zipfile) => {
          if(err) return callback(err);

          const result = { filenames: [] };
          let entries = [];
          let completed = 0;

          zipfile.on('entry', (entry) => entries.push(entry));
          zipfile.on('end', () => {
            if (entries.length === 0) {
              callback(null, result);
              zipfile.close();
            } else {
              entries.forEach((entry) => {
                result.filenames.push(entry.fileName);
                zipfile.openReadStream(entry, (err, resultStream) => {
                  if(err) return callback(err);

                  resultStream.pipe(streamTest.toText((err, contents) => {
                    if(err) return callback(err);

                    result[entry.fileName] = contents;
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
        });
      }, 5); // otherwise sometimes the file doesn't fully drain
    });
  });
};

const pZipStreamToFiles = (zipStream) => new Promise((resolve, reject) => zipStreamToFiles(zipStream, (err, result) => err ? reject(err) : resolve(result)));

module.exports = { zipStreamToFiles, pZipStreamToFiles };

