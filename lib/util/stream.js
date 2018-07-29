const { Transform } = require('stream');
const getCloneable = require('cloneable-readable');
const { ExplicitPromise } = require('./promise');

const mapStream = (f) => new Transform({
  objectMode: true,
  transform(row, _, done) {
    this.push(f(row));
    done();
  }
});

// takes a readable stream and some function that wants to process the stream,
// calls the function with a stream, and returns a Promise.all of the returned
// Promise from the function as well as a Buffer of the stream contents.
const calculateAndBuffer = (stream, ...fs) => {
  const cloneable = getCloneable(stream);
  const calculations = fs.map((f) => f(cloneable.clone()));

  const bufs = [];
  const bufferPromise = new Promise((resolve, reject) => {
    stream.on('data', (chunk) => { bufs.push(chunk); });
    stream.on('error', (err) => { reject(err); });
    stream.on('end', () => { resolve(Buffer.concat(bufs)); });
  });

  return ExplicitPromise.of(Promise.all(calculations.concat(bufferPromise)));
};

module.exports = { mapStream, calculateAndBuffer };

