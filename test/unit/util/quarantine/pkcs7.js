require('should');
const appRoot = require('app-root-path');
const { ge, unpadPkcs7 } = require(appRoot + '/lib/util/quarantine/pkcs7');

describe('crypto: pkcs7 padding decoding', () => {
  describe('constant time >=', () => {
    // ge is expected to work for values 0 <= x <= 255. here we just check all
    // the possibilities.
    it('should work for all values within the expected range @slow', () => {
      for (let x = 0; x < 256; x++) {
        for (let y = 0; y < 256; y++) {
          if (x >= y) ge(x, y).should.equal(-1);
          else        ge(x, y).should.equal(0);
        }
      }
    });
  });

  describe('unpadPkcs7', () => {
    it('should unpad the correct number of Buffer bytes', () => {
      const minIn =  Buffer.from('0102030405060708090a0b0c0d0e01', 'hex');
      const minOut = Buffer.from('0102030405060708090a0b0c0d0e', 'hex');
      unpadPkcs7(minIn).equals(minOut).should.equal(true);

      const midIn =  Buffer.from('0102030405060708090a0505050505', 'hex');
      const midOut = Buffer.from('0102030405060708090a', 'hex');
      unpadPkcs7(midIn).equals(midOut).should.equal(true);

      const maxIn =  Buffer.from('0102030405060708090a0b0c0d0e0f10101010101010101010101010101010', 'hex');
      const maxOut = Buffer.from('0102030405060708090a0b0c0d0e0f', 'hex');
      unpadPkcs7(maxIn).equals(maxOut).should.equal(true);
    });

    it('should error if too large of a padding is specified', () => {
      const x = Buffer.from('0011', 'hex');
      should.not.exist(unpadPkcs7(x));
    });

    it('should error if any padding bytes are not as expected', () => {
      const x = Buffer.from('0102030405060708090a0b0c0d0e0f101010101010101010e0101010101010', 'hex');
      should.not.exist(unpadPkcs7(x));
    });
  });
});

