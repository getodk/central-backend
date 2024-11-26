// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { reduce } = require('ramda');
const { Transform, Writable, PassThrough, pipeline } = require('stream');
const { rejectIfError } = require('./promise');
const getCloneable = require('cloneable-readable');

const mapStream = (f) => new Transform({
  objectMode: true,
  transform(row, _, done) {
    this.push(f(row));
    done();
  }
});

// simple writable helper which writes the stream to a buffer.
const bufferer = (resolve) => {
  const bufs = [];
  const writable = new Writable({
    write(b, _, done) { bufs.push(b); done(); },
    writev(bs, _, done) { bufs.push(...bs); done(); }
  });
  writable.on('finish', () => { resolve(Buffer.concat(bufs)); });
  return writable;
};

// takes a readable stream and some function that wants to consume the stream,
// calls the function with a stream, and returns a Promise.all of the returned
// Promise from the function as well as a Buffer of the stream contents.
const consumeAndBuffer = (stream, ...fs) => {
  const cloneable = getCloneable(stream);
  const promises = fs.map((f) => f(cloneable.clone()));
  promises.push(new Promise((resolve, reject) => {
    pipeline(cloneable, bufferer(resolve), rejectIfError(reject));
  }));

  return Promise.all(promises);
};

// same as consumeAndBuffer, but assumes passthrough streams instead of cloning
// the readable for each calculation. we offer both pipethrough which does not
// buffer, and …AndBuffer which does.
//
// each f takes (resolve, reject) and returns the passthrough stream to pipe through.
const pipethrough = (inStream, ...fs) => {
  const promises = [];
  const streams = [];
  for (const f of fs)
    promises.push(new Promise((resolve, reject) => { streams.push(f(resolve, reject)); }));

  return new Promise((resolve, reject) => {
    const result = Promise.all(promises).catch(reject);
    pipeline(inStream, ...streams, (err) => {
      if (err != null) reject(err);
      else result.then(resolve);
    });
  });
};
const pipethroughAndBuffer = (inStream, ...fs) =>
  pipethrough(inStream, ...fs, bufferer);

const consumerToPiper = (recipient) => (resolve, reject) => {
  const result = new PassThrough();
  recipient(result).then(resolve, reject);
  return result;
};

const splitStream = (inStream, x, y) => {
  const stream = getCloneable(inStream);
  return Promise.all([ x(stream.clone()), y(stream) ]);
};

// we do a number of operations where streams are internally assembled to solve
// a problem (eg in briefcase, read the xml, output rows, transform rows to csv)
// and we would like to use pipeline so error handling/unpipe/etc are smoothly
// handled. but invoking pipeline() requires an immediate commitment of final
// error handling, and often the place that assembly occurs is the wrong place
// to do error handling. so instead, we create a silly thin wrapper around the
// assembly of piped streams, which don't actually get assembled until final
// handling.
//
// right now there are two places PartialPipes are expected and terminated:
// the final result output over the wire, and stream termination into an archive
// via the zipParts handler.
class PartialPipe {
  constructor(streams) {
    this.streams = [];
    for (const stream of streams) {
      if (stream instanceof PartialPipe) this.streams.push(...stream.streams);
      else this.streams.push(stream);
    }
  }
  with(stream) { return new PartialPipe(this.streams.concat([ stream ])); }
  pipeline(errCb) { return pipeline(this.streams, rejectIfError(errCb)); }
  static of(...streams) { return new PartialPipe(streams); }

  // really only used for testing purposes, to masquerade as a normal piped stream.
  // do not use in general; use .with() and .pipeline() above instead.
  _pipe(out) { return reduce(((x, y) => x.pipe(y)), this.streams[0], this.streams.slice(1)).pipe(out); } /* slint-ignore:pipe */
}

module.exports = {
  mapStream,
  consumeAndBuffer, pipethrough, pipethroughAndBuffer,
  splitStream,
  consumerToPiper,
  PartialPipe
};

