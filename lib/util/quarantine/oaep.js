// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
////////////////////////////////////////////////////////////////////////////////
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
//
// EVERYTHING IN THIS FILE IS A REALLY AWFUL IDEA!!!
//
// in this file, we implement our own algorithm for computing inverse (unpad)
// OAEP with MGF1 and a hashing strategy of SHA256. in java-speak, this is:
// OAEPWithSHA256AndMGF1Padding (** note below)
//
// you do not want to do this. you do not want to implement your own cryptographic
// primitives. we only do it here because we have extremely few options.
//
// usually, RSA padding is done with OAEP/MGF1/SHA1. this is the standard, it is
// the recommendation, it is what OpenSSL will do without you asking. for ?????
// reasons, the ODK protocol we need to implement uses SHA256 rather than SHA1.
// it might sound like this is a good idea, because SHA1 is less secure than SHA2,
// but it is commonly understood that way the hashing function is used in the
// OAEP/MGF1 processes obviate the advantages of SHA2.
//
// because the use of SHA256 is so obscure, node's native crypto module (which
// is a binding interface against an embedded OpenSSL) does not allow us to select
// it as our padding hashing strategy.
//
// the openssl CLI tool will do it for you (but only if you use pkeyutl):
// -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256
// so one method would be to shell out to it, since we have it everywhere (taking
// care not to land the privkey on the disk). but macOS ships libreSSL instead
// (which for the record i approve of), whose openssl CLI tool does not implement
// these keyopts because they are not documented officially by OpenSSL. so to use
// this approach would eliminate macOS as a native dev environment.
//
// the ursa library (which is also backed by OpenSSL) also does not allow the SHA256
// hashing strategy we require.
//
// node-forge does, but having reviewed it i do not believe we can trust it. they've
// done their best but they rely on third party code and at the end of the day they're
// working in javascript. it is extraordinarily difficult to look at a piece of JS
// and assert with absolute confidence that it never leaks via instruction pointers,
// or branch indicators, or dependent array indices, or dynamic allocation, or that
// it actually runs in constant time. it does not appear that any serious security
// researcher has done an analysis on node-forge.
//
// that leaves us with three options, none of which are palatable but all of which
// are more defensible than the above:
//
// 1. build a very thin binding layer to OpenSSL which sets the options we would need:
//    EVP_PKEY_CTX_set_rsa_oaep_md(ctx, EVP_sha256());
//    EVP_PKEY_CTX_set_rsa_mgf1_md(ctx, EVP_sha256());
// 2. use node-forge, but sandbox it HEAVILY in a separate process and do our
//    absolute best to pave over any timing/state uncertainty.
// 3. implement our own OAEP unpadding routine.
//
// option 1 is very difficult, option 2 is a lot of work for very little cryptographic
// gain. option 3 i would normally frown upon.
//
// !! !! !! !!! DO NOT IMPLEMENT YOUR OWN CRYPTOGRAPHIC PRIMITIVES !!! !! !! !!
// !! !! !! !!! DO NOT IMPLEMENT YOUR OWN CRYPTOGRAPHIC PRIMITIVES !!! !! !! !!
// !! !! !! !!! DO NOT IMPLEMENT YOUR OWN CRYPTOGRAPHIC PRIMITIVES !!! !! !! !!
//
// and yet, here we are, implementing our own cryptographic primitives. ultimately,
// the reason this route was chosen was because we can make certain assumptions
// in our particular use case that radically simplify the algorithm as typically
// implemented:
//
// 1. the digest length will always be 256 bits. this fact is why we are on this
//    whole stupid journey to begin with.
// 2. the final cleartext length will always be 32 bytes. usually, once the final
//    db is obtained, one must hunt for The One (the first 0x01 byte) starting from
//    byte digestlen + 1 (33 in our case). everything after Neo is your cleartext.
//    the branching this entails is where a lot of the security headache would usually
//    come from: here is a lot of weird math and conditional operation work that must
//    come out to constant time. you can take a look at node-forge's implementation
//    and see how they're feeling about it (the answer is "queasy"):
//    https://github.com/digitalbazaar/forge/blob/0627c5bc7f97dbba7293deed595ff9521bd0aa42/lib/pkcs1.js#L235
//    but we don't need to do that: we can just slice off the final 32 bytes and
//    call it good.
// 3. related to #2, we don't have an extraordinarily strong need to perform error
//    checking. typically, you'd error if the first byte of the input buffer is
//    anything other than 0x0, if the first db digestlen bytes mismatch a digest
//    of the label (which by default is empty/null), or if any of the db bytes from
//    there to The One (0x01) is anything but 0x0.
//
//    but we know exactly what our cleartext length should be. we aren't trying
//    to write a consumer-use library here: if it's not right the subsequent AES
//    decryption will fail anyway, and if we should have rejected the user input
//    it would have been upon data ingress which could have been many moons ago.
//
// ultimately, there are four basic things to convince yourself of here to verify
// the security of this operation (though if you are a real security expert you
// should ignore me):
//
// 1. constant time execution.
// 2. no branch instructions based off secret values.
// 3. all allocation up front.
// 4. all allocated buffers filled fully with input data.
//
// the deal with #4 is that Buffer.allocUnsafe is analogous to malloc.
// (Buffer.alloc is analogous to calloc.)
//
// okay, so that's all. please don't use this. bye.
//
// (** so it additionally transpires that Java allows the specification of
// OAEPWithSHA256AndMGF1Padding OR OAEPWithSHA-256AndMGF1Padding which doesn't
// seem like so big a deal until you learn that without a hyphen, Bouncy Castle
// is used, and with a hyphen Java JCE is used. and /that/ doesn't seem like so
// big a deal until you learn that BC uses SHA256 for both OAEP and MGF1, while
// JCE uses SHA256 for OEAP, but sticks with SHA1 for MGF1. IETF thinks you
// should not mix the algos.)
//
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
////////////////////////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////////////////////////
// EXTERNAL FUNCTION ANALYSIS
// some analysis and justification of external functions used.
//
// Math.ceil (v8)
// is constant time under numbers smaller than 0x80000000 (in which case a cast
// to uint32 is performed.) additionally, the only values it may be fed are
// 32 / 32 = 1, and 223 / 32 = 6.96875, neither of which are sensitive.
//
// createHash/update/digest
// i sure hope these are cryptographically safe.
//
// Buffer.allocUnsafe, Buffer#subarray
// some branching etc occurs internally but all input values are constant.
//
// Buffer#writeInt32BE
// does some branching (checkInt in buffer.js) but the input sequence is fixed:
// 0 0 1 2 3 4 5 6
//
// Buffer#copy
// again, branching beacuse loop, but input bounds are constant, so the loop bounds
// ought to be as well.

/* eslint-disable */

const { ceil } = Math;
const { createHash } = require('crypto');

// seed: Buffer containing the mgf seed
// out: Buffer sized appropriately to fit the mgf1-generated mask output
const counter = Buffer.allocUnsafe(4);
const mgf1 = (seed, out) => {
  const iters = ceil(out.length / 32);
  for (let i = 0; i < iters; i++) {
    counter.writeInt32BE(i);
    createHash('sha256').update(seed).update(counter).digest().copy(out, i * 32);
  }
};

// xors two Buffers, mutates the second with the result. they better be the same len.
const xor = (x, y) => {
  const len = x.length;
  for (let i = 0; i < len; i++) y[i] ^= x[i];
};

// the big show.
// NOTE THE FOLLOWING:
// 1. never give this function any input length other than 256 bytes!
// 2. this function will fail on any payload whose cleartext length is anything other than 32 bytes!
const unpadPkcs1OaepMgf1Sha256 = (input) => {
  // initialize all buffers immediately.
  const seed = Buffer.allocUnsafe(32);
  const db = Buffer.allocUnsafe(223); // (input length = 256) - 33
  const result = Buffer.allocUnsafe(32);

  // create references to byte ranges within the input buffer.
  const maskedSeed = input.subarray(1, 33);
  const maskedDb = input.subarray(33, 256);

  // unmask the seed then the db
  mgf1(maskedDb, seed); // seed now contains the seed mask
  xor(maskedSeed, seed); // seed now contains the seed
  mgf1(seed, db); // db now contains the db mask
  xor(maskedDb, db); // db now contains the db

  // now pull the final 32 bytes off, which is our result.
  db.copy(result, 0, 191, 223); // 223 is db length as explained above; 191 = 223 - 32
  return result;
};

module.exports = { unpadPkcs1OaepMgf1Sha256 };

