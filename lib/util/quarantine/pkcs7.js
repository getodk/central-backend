/* eslint-disable */

////////////////////////////////////////////////////////////////////////////////
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
//
// EVERYTHING IN THIS FILE IS A REALLY AWFUL IDEA!!!
//
// sigh. see the note at the top of oaep.js (the other file in this directory)
// for full notes, but essentially, because the ODK specification asks for PKCS#7
// padding despite the use of CFB mode, we end up with padding junk at the end
// of our "cleartext" once openssl is done with it.
//
// openssl doesn't think there should be padding due to the mode, and nodejs
// autoPadding doesn't detect it either. so once again, we are left to implement
// our own cryptographic routine.
//
// !! !! !! !!! DO NOT IMPLEMENT YOUR OWN CRYPTOGRAPHIC PRIMITIVES !!! !! !! !!
// !! !! !! !!! DO NOT IMPLEMENT YOUR OWN CRYPTOGRAPHIC PRIMITIVES !!! !! !! !!
// !! !! !! !!! DO NOT IMPLEMENT YOUR OWN CRYPTOGRAPHIC PRIMITIVES !!! !! !! !!
//
// the node-forge implementation leaks tons of information via timing attack in
// at least two different ways, despite its comments claiming to the contrary:
// 1 the loop length is determined by the padding length
// 2 the boolean logic short-circuits once it latches false
//
// this one is more or less directly adapted from libressl.
//
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
// WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING WARNING
////////////////////////////////////////////////////////////////////////////////


// constant time operation, insofar as guaranteeable within JS.
// probably works for CPU architectures up to 256 bits or whatever.
// returns 0 if a < b, -1 if a >= b
const ge = (a, b) => ~(a - b) >> 256 - 1;
// we export this for testing but DO NOT USE THIS DO NOT USE THIS DO NOT USE THIS
// DO NOT USE THIS DO NOT USE THIS DO NOT USE THIS DO NOT USE THIS DO NOT USE THIS
//
// please

// returns Buffer (it will be a subarray reference to the input buffer) of the
// unpadded result, or else throws.
const unpadPkcs7 = (buffer) => {
  const len = buffer.length;
  const padLen = buffer[len - 1];

  // check a fixed count of 16 bytes (we know we are using aes) for the
  // padding byte. accumulate errors in good.
  let good = ge(16, padLen);
  for (let i = 0; i < 16; i++) {
    const mask = ge(padLen - 1, i); // TODO: why do libressl and forge BOTH expect paddingbyte + 1?
    const b = buffer[len - 1 - i];
    good &= ~(mask & (padLen ^ b));
  }

  // now actually check for errors in good. because we can't know our architecture
  // bitsize, we do the same & operation but do a different masking to finalize
  // the check. all the shifting will propagate any 0s in the first eight bytes
  // to the LSB (check it for yourself).
  good &= good >> 4;
  good &= good >> 2;
  good &= good >> 1;
  const bad = (good & 1) - 1 >> 256; // check LSB eq 0

  // now that all the sensitive work is done we gate and form the appropriate
  // output. subarray does a lot of branching to perform bounds checking, but
  // so long as we give it values within bounds it ought not to depend on
  // sensitive values.
  const result = buffer.subarray(0, len - padLen);
  return bad ? null : result;
};

module.exports = { ge, unpadPkcs7 };

