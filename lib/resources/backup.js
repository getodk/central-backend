// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { createReadStream, readdir, unlink } = require('fs');
const { Transform } = require('stream');
const { promisify } = require('util');
const { randomFillSync } = require('crypto');
const { basename, join } = require('path');
const { mergeRight } = require('ramda');
const archiver = require('archiver');
const tmp = require('tmp-promise');
const { Config } = require('../model/frames');
const { pgdump } = require('../task/db');
const { generateManagedKey, generateLocalCipherer } = require('../util/crypto');
const { block } = require('../util/promise');
const { PartialPipe } = require('../util/stream');
const { noop } = require('../util/util');


// we have one strange problem to solve in order to achieve ad-hoc backups:
// pgdump can take several minutes, and a tcp connection can time out after
// as soon as 30 seconds.
//
// the first approach here relied on streaming keepalive http headers, which
// worked in general but not with nginx, which wants to for whatever reason
// buffer all response headers until the actual response begins. can't change
// it. and doing it that way we had to call private node methods.
//
// this is a different approach. we first (down below in backup()) shove 32KB
// of random data at the very start of the zip. we know this will flush through
// the archive transform stream. now we just want to slow down that junk data
// to buy us time for the real data to be ready.
//
// this trickler stream traps all data passing through it, trickling it out 128
// bytes at a time every 5 seconds. once trickling is no longer required, it
// forwards all data out as quickly as possible. the `released` flag is set to
// true and the interval is cancelled when trickling is let go.
//
// partly as an optimization and partly to ensure our keepalive bursts are all
// > 100 bytes, we immediately flush out all front matter until we get the actual
// random data, which comes in as a 16KB highwatermark chunk followed by a second
// slightly smaller chunk. this is managed by the `trapped` flag.
const trickler = () => {
  const chunks = [];

  let trapped = false; // have we seen the first large chunk yet?
  let released = false; // do we no longer need to trickle?
  const transform = new Transform({
    transform(data, _, done) {
      // shortcut out if we don't need to trickle, or if we have some tiny
      // header material. otherwise, put the data in our own buffer.
      if (released) return done(null, data);
      if (!trapped && (data.length < 128)) return done(null, data);

      trapped = true;
      chunks.push(data);
      done();
    }
  });

  // every 5 seconds, flush up to 128 bytes of data.
  let ptr = 0;
  const timer = setInterval(() => {
    if (chunks.length === 0) return; // really shouldn't be possible but hey
    if (transform.destroyed || transform.writableEnded)
      return clearInterval(timer); // we don't have anything to write to anymore. bail.

    const out = chunks[0];
    if ((ptr + 128) >= out.length) {
      transform.push(out.slice(ptr));
      chunks.shift();
      ptr = 0;
    } else {
      transform.push(out.slice(ptr, ptr + 128));
      ptr += 128;
    }
  }, 5000);

  // indicate that we are out of trickling and flush all buffered data.
  const release = () => {
    released = true;
    clearInterval(timer);

    if (chunks.length === 0) return; // whew ?
    transform.push(chunks[0].slice(ptr));
    for (let idx = 1; idx < chunks.length; idx += 1) transform.push(chunks[idx]);
  };

  return [ transform, release ];
};


const backup = (keys, response) => {
  // set headers
  response.set('Content-Disposition', `attachment; filename="central-backup-${(new Date()).toISOString()}.zip"`);
  response.set('Content-Type', 'application/zip');

  // set up our response stream pipeline. we'll need the trickler to keep the
  // connection alive while we process the pgdump.
  const zipStream = archiver('zip', { zlib: { level: -1 } });
  const [ trickle, release ] = trickler();

  // add a 32KB file full of random data to the very start of the archive. we
  // need the randomness to be sure zip can't compress it smaller than a node
  // buffer block (16KB).
  const keepalive = Buffer.allocUnsafe(32000);
  randomFillSync(keepalive);
  zipStream.append(keepalive, { name: 'keepalive' });

  // get our configuration and obtain a tmpdir to dump the database into.
  // we don't bother catching any errors here since we can't return any kind of
  // useful message to the user anyway, and there is nothing to clean up.
  tmp.withDir((tmpdir) => pgdump(tmpdir.path).then(() => {
    // halt the keepalive.
    release();

    // TODO: mostly copypasta for now from lib/task/fs:
    return promisify(readdir)(tmpdir.path).then((files) => {
      // create a cipher-generator for use below.
      const [ localkey, cipherer ] = generateLocalCipherer(keys);
      const local = { key: localkey, ivs: {} };

      // add each file generated by the backup process.
      for (const file of files) {
        const filePath = join(tmpdir.path, file);
        const [ iv, cipher ] = cipherer();
        local.ivs[basename(file)] = iv.toString('base64');

        const readStream = createReadStream(filePath);
        zipStream.append(readStream.pipe(cipher), { name: file });
        readStream.on('end', () => { unlink(filePath, noop); }); // free things up as we can
      }
      zipStream.append(JSON.stringify(mergeRight(keys, { local })), { name: 'keys.json' });

      // this promise return lock management controls the cleanup of the zipfile,
      // not the return of the result. that is set up as soon as .finalize() is called.
      const [ lock, unlock ] = block();
      zipStream.on('finish', unlock);
      zipStream.on('error', unlock);
      zipStream.finalize();
      return lock;
    });
  }).catch(() => { response.destroy(); })); // terminate if the pgdump fails.

  return PartialPipe.of(zipStream, trickle);
};


module.exports = (service, endpoint) => {
  service.post('/backup', endpoint((_, { auth, body }, __, response) =>
    auth.canOrReject('backup.run', Config.species)
      .then(() => generateManagedKey(body.passphrase))
      .then((keys) => backup(keys, response))));
};

