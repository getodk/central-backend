// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { curry } = require('ramda');
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
const mapStreamToPromises = curry((map, stream) => new Promise((resolve, reject) => {
  const promises = [];
  stream.on('data', (obj) => map(obj).ifDefined((promise) => { promises.push(promise); }));
  stream.on('error', reject);
  stream.on('end', () => { resolve(Promise.all(promises)); });
}));

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

// same as consumeAndBuffer, but assumes passthrough streams instead of cloning
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

const splitStream = (inStream, x, y) => {
  const stream = getCloneable(inStream);
  return Promise.all([ x(stream.clone()), y(stream) ]);
};

module.exports = { mapStream, mapStreamToPromises, consumeAndBuffer, passthroughAndBuffer, splitStream };

