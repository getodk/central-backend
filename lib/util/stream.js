const { Transform } = require('stream');
const getCloneable = require('cloneable-readable');

const mapStream = (f) => new Transform({
  objectMode: true,
  transform(row, _, done) {
    this.push(f(row));
    done();
  }
});

// given a stream, takes a map function that turns each stream object into either
// a Some(Promise) or a None. returns Promise.all on all the returned Promises.
const mapStreamToPromises = (map, stream) => new Promise((resolve, reject) => {
  const promises = [];
  stream.on('data', (obj) => map(obj).ifDefined((promise) => { promises.push(promise); }));
  stream.on('error', reject);
  stream.on('end', () => { resolve(Promise.all(promises)); });
});

// helper for the two *AndBuffer utilities below which handles the buffering
// and promise formulation part.
const _xAndBuffer = (stream, promises) => {
  const bufs = [];
  const bufferPromise = new Promise((resolve, reject) => {
    stream.on('data', (chunk) => { bufs.push(chunk); });
    stream.on('error', reject);
    stream.on('end', () => { resolve(Buffer.concat(bufs)); });
  });

  return Promise.all(promises.concat(bufferPromise));
};

// takes a readable stream and some function that wants to consume the stream,
// calls the function with a stream, and returns a Promise.all of the returned
// Promise from the function as well as a Buffer of the stream contents.
const consumeAndBuffer = (stream, ...fs) => {
  const cloneable = getCloneable(stream);
  const promises = fs.map((f) => f(cloneable.clone()));
  return _xAndBuffer(stream, promises);
};

// same as calculateAndBuffer, but assumes passthrough streams instead of cloning
// the readable for each calculation.
//
// each f takes (resolve, reject) and returns the passthrough stream to pipe through.
const passthroughAndBuffer = (inStream, ...fs) => {
  const promises = [];
  let stream = inStream;
  for (const f of fs) {
    promises.push(new Promise((resolve, reject) => { // eslint-disable-line no-loop-func
      stream = stream.pipe(f(resolve, reject));
    }));
  }

  return _xAndBuffer(stream, promises);
};

module.exports = { mapStream, mapStreamToPromises, consumeAndBuffer, passthroughAndBuffer };

