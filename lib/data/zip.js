const { Readable } = require('stream');
const archiver = require('archiver');

// a little utility to make it easier to merge files from multiple sources into
// a single zip stream. rather than devise a whole eventemitter protocol, we just
// use objectMode streams of streams, which already embody our workflow.

const zipPart = () => {
  const streamStream = new Readable({ read() {}, objectMode: true });
  return {
    stream: streamStream,
    append: (stream, options) => streamStream.push({ stream, options }),
    finalize: () => streamStream.push(null)
  };
};

const zipStreamFromParts = (...zipParts) => {
  let completed = 0;
  const resultStream = archiver('zip', { zlib: { level: 9 } });

  for (const part of zipParts) {
    part.stream.on('data', ({ stream, options }) => resultStream.append(stream, options));
    part.stream.on('end', () => { // eslint-disable-line no-loop-func
      completed += 1;
      if (completed === zipParts.length)
        resultStream.finalize();
    });
  }

  return resultStream;
};

module.exports = { zipPart, zipStreamFromParts };

