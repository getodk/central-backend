const { KeyObject } = require('node:crypto');
const appRoot = require('app-root-path');
const { readFileSync } = require('fs');
const should = require('should');
const streamTest = require('streamtest').v2;
const crypto = require(appRoot + '/lib/util/crypto');

describe('util/crypto', () => {
  describe('hashPassword/verifyPassword', () => {
    const { hashPassword, verifyPassword } = crypto;

    // we do not actually verify the hashing itself, as:
    // 1. it is entirely performed by bcrypt, which has is own tests.
    // 2. bcrypt is intentionally slow, and we would like unit tests to be fast.

    it('should always return a Promise', () => {
      hashPassword('').should.be.a.Promise();
      hashPassword('password').should.be.a.Promise();
      hashPassword('password', 'hashhash').should.be.a.Promise();
    });

    it('should return a Promise of null given a blank plaintext', (done) => {
      hashPassword('').then((result) => {
        should(result).equal(null);
        done();
      });
    });

    it('should not attempt to verify empty plaintext', (done) => {
      verifyPassword('', '$2a$12$hCRUXz/7Hx2iKPLCduvrWugC5Q/j5e3bX9KvaYvaIvg/uvFYEpzSy').then((result) => {
        result.should.equal(false);
        done();
      });
    });

    it('should not attempt to verify empty hash', (done) => {
      verifyPassword('password', '').then((result) => {
        result.should.equal(false);
        done();
      });
    });
  });

  describe('generateToken', () => {
    const { generateToken } = crypto;
    it('should return 48-byte tokens by default', () => {
      generateToken().should.be.a.token();
    });

    it('should ignore legacy length argument', () => {
      generateToken(12).should.be.a.token();
    });
  });

  describe('isValidToken()', () => {
    const { generateToken, isValidToken } = crypto;

    [
      generateToken(), generateToken(), generateToken(), generateToken(),
      generateToken(), generateToken(), generateToken(), generateToken(),
      generateToken(), generateToken(), generateToken(), generateToken(),
      generateToken(), generateToken(), generateToken(), generateToken(),
    ].forEach(validToken => {
      it(`should return true for valid token '${validToken}'`, () => {
        isValidToken(validToken).should.be.true();
      });
    });

    [
      undefined,
      null,
      '',
      generateToken() + 'a',
      generateToken().substr(1),
    ].forEach(invalidToken => {
      it(`return false for invalid token '${invalidToken}'`, () => {
        isValidToken(invalidToken).should.be.false();
      });
    });
  });

  describe('generateVersionSuffix', () => {
    const { generateVersionSuffix } = crypto;
    it('should generate a suffix', () => {
      generateVersionSuffix().should.match(/^\[encrypted:[a-zA-Z0-9+/]{8}\]$/);
    });
  });

  describe('stripPemEnvelope', () => {
    const { stripPemEnvelope } = crypto;
    it('should strip the envelope', () => {
      stripPemEnvelope('-----BEGIN PUBLIC KEY-----\n' +
        'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAreufmd474DLrlZGNJVMB\n' +
        'os/C+UNjMCb7mqJO9GxI1+Z4NFxUT0jEiiU3OkL8aEXmJObne90O+eWWLT9lrLeJ\n' +
        'VqPLj2Yov7UUpGGymrIpt5Z9+GwYPQ88Yczm8pg1M8n7FXy8ZrmgAwKxw+pM6enW\n' +
        '6NiMknxVOjJ6PcNGBAIqrfxMRg2BntiIZ/sP+jjQgDb7xDBfjjNQLlvcwL4BN3aj\n' +
        'VNgYXqN4Xtf49aXOJXN4yCqfRjeJEosR5d5hPihvcNbyA4DrDYeNC2hv0YLJ+UiQ\n' +
        'iFFE9DTPVzh4awS8IAbjUerEv3ffJU6Cyaf/GIyWp/1kywNgAIzkMKb4UHrp69HH\n8QIDAQAB\n' +
        '-----END PUBLIC KEY-----\n').should.equal('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAreufmd474DLrlZGNJVMBos/C+UNjMCb7mqJO9GxI1+Z4NFxUT0jEiiU3OkL8aEXmJObne90O+eWWLT9lrLeJVqPLj2Yov7UUpGGymrIpt5Z9+GwYPQ88Yczm8pg1M8n7FXy8ZrmgAwKxw+pM6enW6NiMknxVOjJ6PcNGBAIqrfxMRg2BntiIZ/sP+jjQgDb7xDBfjjNQLlvcwL4BN3ajVNgYXqN4Xtf49aXOJXN4yCqfRjeJEosR5d5hPihvcNbyA4DrDYeNC2hv0YLJ+UiQiFFE9DTPVzh4awS8IAbjUerEv3ffJU6Cyaf/GIyWp/1kywNgAIzkMKb4UHrp69HH8QIDAQAB');
    });
  });

  describe('generateManagedKey', () => {
    const { generateManagedKey } = crypto;
    it('should return reasonable values in a Promise @slow', (done) => {
      generateManagedKey('test').then((result) => {
        result.pubkey.should.be.a.base64string();
        result.privkey.should.be.a.base64string();
        result.salt.should.be.a.base64string();
        result.iv.should.be.a.base64string();
        done();
      });
    });
  });

  describe('generateLocalCipherer', () => {
    const { generateManagedKey, generateLocalCipherer } = crypto;
    it('should return an encipherer with a local key @slow', (done) => {
      generateManagedKey('test').then((keys) => {
        const [ localkey, cipherer ] = generateLocalCipherer(keys);
        localkey.should.be.a.base64string();
        cipherer.should.be.a.Function();
        done();
      });
    });

    it('should return an (iv, cipher) tuple when the cipherer is given an iv @slow', (done) => {
      generateManagedKey('test').then((keys) => {
        const [ , cipherer ] = generateLocalCipherer(keys);
        const [ iv, cipher ] = cipherer();
        iv.should.be.a.base64string();
        cipher.update.should.be.a.Function();
        cipher.final.should.be.a.Function();
        done();
      });
    });
  });

  describe('getPrivate()', () => {
    const { getPrivate } = crypto;

    [
      {
        iv: "7+ELinzekqZOaOiGSRgYxw==",
        salt: "7jE50XhstDF97pN4YlPS/g==",
        pubkey: "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUFxcHR1dnhpQWtINE5vdVRJTU1sVQp1Q2VxODJjNXdaZWEyQ3R4Uzg1U1A2NCsxQWJLSHdHWDhXYU5YRTNyUlZOQ3l5SzYvQTlWSWJ3ZWg5OXZjOEhnCnI2bFplcjhwOGhtTlFheXdUbThHczA2NllNTkQ3SExVY2h4dmdML2xYQjVwYlVtNDk1VkQrbE9HODJkbEExTSsKODFTTHBhaUovSzdNcVhHK2ZwbkM0UXpVWlRNMXY5RUlyRTVvbDFVL1JYQi9IZERzaXRwNnlROEJwNm5TdVlzRQoveURwUlNGTEFCZWFCTkN6cGxLZHY5ZVFaSmdtNjV2MVcxNlBteGNNRmVXM21RcHJOWTczZ1YvUFpCL25vTjdlClZ2cXl6R0hHajlJZmFBMnVjandVYmxjbFFVNElIR1FBaEtCZGlReEpHL1g2TDVqdVpQU3NYQW5NbENqR21vWm4KU1FJREFRQUIKLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tCg==","privkey":"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",
      },
      {
        iv: "n8nUrZ4vr2ivj4DI/9L3Iw==",
        salt: "wlws0kI3fosgvE8g1z9rRw==",
        pubkey: "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUEzQWp4bG9pM3lFZkh1NytQZSs3OAplR25zTEpuNUNMMmE1akd4SkhPemZRSDQ1Ti9tZ0tpN2J3WVhyYldST0M0UHFSelRzMm1FZ1JvRHE1SFJSS2VMCkNTWjF0MUo3QlNvMytzRXRxTG16VlNkd3NpNjdwTHM1N0dteVltN1QwTSttS3Bka1IrUStJRWFoczBDZGUrc1oKVExBZzhqdkJPTDZGN1MvYytoeXdTNjJEVUNBd093eGhwNHhTWjdjbzVCS2JMOHEzZS9lOUh6elFoNHVZS05rTAp2ZkEybi82MVFEd3dIcElXcm5pSHRmMFRFLzFaY0c2MnUwK3F0aHhXNE93K0lrRHE2VnNBbkxHd3p2VDIzWXZpCk1LYWtESThzNUtudm5wenI4TFo4ZnVGcTFHTTIwWVg2cDRIdWE5ZUF0TlZmckNiRXk4SUFDVnpITzY2VnlHWXMKcXdJREFRQUIKLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tCg==","privkey":"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",
      },
    ].forEach((keys, idx) => {
      it(`should generate private key from example #${idx} with correct passphrase`, async () => {
        const res = await getPrivate(keys, 'supersecret');
        (res instanceof KeyObject).should.be.true();
      });

      [
        'wrong',
        'very-wrong',
      ].forEach(passphrase => {
        it(`should fail gracefully with incorrect passphrase '${passphrase}'`, async () => {
          try {
            await getPrivate(keys, passphrase);
            should.fail('Incorrect passphrase should have been rejected.');
          } catch (err) {
            err.should.be.a.Problem();
            err.problemCode.should.eql(400.12);
            err.message.should.eql( 'Could not perform decryption. Double check your passphrase and your data and try again.');
          }
        });
      });
    });
  });

  describe('getLocalDecipherer', () => {
    const { generateManagedKey, generateLocalCipherer, getLocalDecipherer } = crypto;
    it('should successfully round-trip a piece of data @slow', () =>
      generateManagedKey('topsecret').then((initkeys) => {
        // create local cipher; encrypt our plaintext.
        const [ localkey, cipherer ] = generateLocalCipherer(initkeys);
        const [ localiv, cipher ] = cipherer();

        const plain = 'a way a lone a last a loved a long the riverrun,';
        const encrypted = cipher.update(plain, 'utf8', 'base64') + cipher.final('base64');

        // now get a local decipher and decrypt. verify round-trip.
        const keys = { privkey: initkeys.privkey, salt: initkeys.salt, iv: initkeys.iv, local: { key: localkey } };
        return getLocalDecipherer(keys, 'topsecret').then((decipherer) => {
          const decipher = decipherer(localiv);
          const unencrypted = decipher.update(encrypted, 'base64', 'utf8') + decipher.final('utf8');

          unencrypted.should.equal(plain);
        });
      }));
  });

  describe('submission decryption', () => {
    const { getSubmissionKey, getSubmissionIvs, getSubmissionCleartext, streamSubmissionCleartext } = crypto;

    // test keypair used for some of the below tests:
    const priv = readFileSync(appRoot + '/test/data/priv.pem', 'utf8');

    describe('key retrieval', () => {
      // this test overlaps completely in coverage with the end-to-end test below,
      // but at least this code is run in isolation so if something fails it's
      // a little easier to figure out what.
      it('should get and unpad a key encrypted by Collect', () => {
        const encAesKey = Buffer.from('heF9tzGvB1jjjBM5AAADnTgrFwmtyjESyCNk86oiX/r+WCohyEX3f4jOswK4/IBLx9VNW4k1wbo0t9PMp4Ie/PAucyBwyqKpx6coGkk8nCeznzisLe07fr9a6MEFOuBqKWun28M/cDUasoyg8//ytMVatSMGjv+Nkj8L7QtlMH6iDJoWZQfwvxgDeCrBn2+jr+qwdlQzxwyi5taV+zB9s+FDgJ14n8AyY3t4x0n+qkOqEvMVKIFc4ofRXBaG5N/21Uy+qA91Ap26sVDo7g1vmG+gND/f+Mx1gBQcmM0EKHowUT5cIdrG6N/XTHVpCWkH6qxjhuWyayCGBT+Frxf+Sg==', 'base64');
        const aesKey = Buffer.from('3TJoHf74zHbDwG3Ta+bcvfUr50C6yF/astfu+CdSnQU=', 'base64');
        getSubmissionKey(priv, encAesKey).equals(aesKey).should.equal(true);
      });
    });

    describe('iv generation', () => {
      it('should generate the appropriate IVs', () => {
        const instanceId = 'uuid:22525f8e-4f2d-41ed-94da-4c46a2478448';
        const aesKey = Buffer.from('3TJoHf74zHbDwG3Ta+bcvfUr50C6yF/astfu+CdSnQU=', 'base64');

        const ivs = getSubmissionIvs(instanceId, aesKey);
        // eslint-disable-next-line space-in-parens
        ivs( 0).equals(Buffer.from('39bbb0890f3222269da68b172146477a', 'hex')).should.equal(true);
        // eslint-disable-next-line space-in-parens
        ivs( 1).equals(Buffer.from('39bcb0890f3222269da68b172146477a', 'hex')).should.equal(true);
        // eslint-disable-next-line space-in-parens
        ivs( 8).equals(Buffer.from('39bcb18a103323279ea68b172146477a', 'hex')).should.equal(true);
        ivs(15).equals(Buffer.from('39bcb18a103323279ea78c182247487b', 'hex')).should.equal(true);
        ivs(23).equals(Buffer.from('3abdb28b113424289ea78c182247487b', 'hex')).should.equal(true);
        ivs(31).equals(Buffer.from('3abdb28b113424289fa88d192348497c', 'hex')).should.equal(true);
      });
    });

    describe('end-to-end', () => {
      // this test data was generated by Collect v1.22.4.
      const instanceId = 'uuid:99b303d9-6494-477b-a30d-d8aae8867335';
      const encAesKey = Buffer.from('iyEB1LAlvVE8uaW0HuhLhzwcLceIukqfgusDNdDEE2FFxVtUtSI3FiOuNxhgI/Zbgnaabh/vqeZ3yLXwv0f66pAbN0n8kM9f84VJR18fdUp6doOz7o8IQD7gc3ZfbRXweab/NxnahfYa9ij0Kax1LTKS05Oodk2MewkzwfBhdbf/CfiBP1HSskDio40jdW5f04GkqZsFCPUluF2DfMnwYCo0wdwf2m8o+lSNR+vrFeEYG7LtGE4X90pVrQnJHwFWHGjSwJpg/USn5skBioDKUCv/Dva9xJ+JXUz+QSg6LOuP+SDxsrmf36WKrnE8kWfN4oaBdmIwFSStkLH9foNXUw==', 'base64');
      const ciphertext = Buffer.from('kMhJdk0mZOqvlxndUO3v4+UPvfYoc+bbkPmF3QmhoP7lP/QjHbzqw/IfZxQ54D328eCc4V6jtbrjeAXV+m1cWsCGGLW5KwTAxBjPBXzsZrUeY0RISVJ1g9BJoXfSRAjYMrFYOM907BFUIYYxMqpVWGy1lo8ljqY+Sgq1VphkQk/TQGgOVYFALHDLOYnLKuLHvwBLQQwK3lje8CwNlf/b2rY9qfGC4P1emoiP+YzkLp8eH6x/HfMvRIFoZEaom1i5s3SU4WVwe2Tno4jKD69ojMlQN6VKB7DK4xaRSs2C7zfDm63n1WCyyOAj8mASIFhb3sc3hD56HTJFUV/TH3UVlzP7oPm/Mm7nEcU3+HdSSwm3I1qFYhsXfVRym41IlbC4Twf660/kUZrugA7Zqd5K9Un3lOVTzYowaF+m5OIOO56wff3zPBxeOVjANDKR7V6/', 'base64');
      const plaintext = `<?xml version='1.0' ?><data id="encrypted" version="working3" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa"><meta><instanceID>uuid:99b303d9-6494-477b-a30d-d8aae8867335</instanceID></meta><name>bob</name><age>30</age><file>1561432532482.jpg</file></data>`;

      it('should successfully decrypt data syncronously @slow', () => {
        const aesKey = getSubmissionKey(priv, encAesKey);
        const ivs = getSubmissionIvs(instanceId, aesKey);

        const result = getSubmissionCleartext(aesKey, ivs(1), ciphertext);
        result.toString('utf8').should.equal(plaintext);
      });

      it('should successfully decrypt data by stream (chunk pattern 1) @slow', (done) => {
        const aesKey = getSubmissionKey(priv, encAesKey);
        const ivs = getSubmissionIvs(instanceId, aesKey);

        // the ciphertext above is 336 bytes. we divide this into chunks of 16 bytes
        // except the last chunk which we split into two chunks of 8 bytes just
        // to try to trip up the debufferer.
        const chunks = [];
        // eslint-disable-next-line no-plusplus
        for (let i = 0; i < 18; i++) { chunks.push(ciphertext.subarray(i * 16, (i + 1) * 16)); }
        chunks.push(ciphertext.subarray(288, 328));
        chunks.push(ciphertext.subarray(328, 336));

        streamSubmissionCleartext(aesKey, ivs(1), streamTest.fromChunks(chunks))
          .pipe(streamTest.toText((_, result) => {
            result.should.equal(plaintext);
            done();
          }));
      });

      // we do that test again with a slightly different chunking pattern to exercise
      // all the possible branch paths. we deliberately underfill the buffer at the
      // right moment (320-332) to make sure the reserve does not flush in that case.
      it('should successfully decrypt data by stream (chunk pattern 2) @slow', (done) => {
        const aesKey = getSubmissionKey(priv, encAesKey);
        const ivs = getSubmissionIvs(instanceId, aesKey);

        const chunks = [];
        // eslint-disable-next-line no-plusplus
        for (let i = 0; i < 20; i++) { chunks.push(ciphertext.subarray(i * 16, (i + 1) * 16)); }
        chunks.push(ciphertext.subarray(320, 332));
        chunks.push(ciphertext.subarray(332, 336));

        streamSubmissionCleartext(aesKey, ivs(1), streamTest.fromChunks(chunks))
          .pipe(streamTest.toText((_, result) => {
            result.should.equal(plaintext);
            done();
          }));
      });

      it('should throw a Problem if the padding is invalid', () => {
        const unpaddedCiphertext = Buffer.from('kMhJdk0mZOqvlxndUO3v4+UPvfYoc+bbkPmF3QmhoP7lP/QjHbzqw/IfZxQ54D328eCc4V6jtbrjeAXV+m1cWsCGGLW5KwTAxBjPBXzsZrUeY0RISVJ1g9BJoXfSRAjYMrFYOM907BFUIYYxMqpVWGy1lo8ljqY+Sgq1VphkQk/TQGgOVYFALHDLOYnLKuLHvwBLQQwK3lje8CwNlf/b2rY9qfGC4P1emoiP+YzkLp8eH6x/HfMvRIFoZEaom1i5s3SU4WVwe2Tno4jKD69ojMlQN6VKB7DK4xaRSs2C7zfDm63n1WCyyOAj8mASIFhb3sc3hD56HTJFUV/TH3UVlzP7oPm/Mm7nEcU3+HdSSwm3I1qFYhsXfVRym41IlbC4Twf660/kUZrugA7Zqd5K9Un3lOVTzYowaF+m5OIOO56wff3zPBxeOVjANA==', 'base64');
        const aesKey = getSubmissionKey(priv, encAesKey);
        const ivs = getSubmissionIvs(instanceId, aesKey);

        let thrown = false;
        try { // i know about should.throws but i can't get it to assert the specific error type.
          getSubmissionCleartext(aesKey, ivs(1), unpaddedCiphertext);
        } catch (ex) {
          ex.message.should.equal('Could not perform decryption. Double check your passphrase and your data and try again.');
          thrown = true;
        }
        thrown.should.equal(true);
      });
    });
  });

  describe('ursa backwards compatibility', () => {
    const { getLocalDecipherer } = crypto;

    // this encrypted data generated by Central code circa v0.5:
    const keys = {
      privkey: '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',
      salt: 'F0TLadQjPnPGOfUQ2kZM+g==',
      iv: 'hXs4HQKvDyP+kOlf9Y1ByA==',
      local: { key: 'bcFeKDF3Sg8W91Uf5uxaIlM2uK0cUN9tBSGoASbC4LeIPqx65+6zmjbgUnIyiLzIjrx4CAaf9Y9LG7TAu6wKPqfbH6ZAkJTFSfjLNovbKhpOQcmO5VZGGay6yvXrX1TFW6C6RLITy74erxfUAStdtpP4nraCYqQYqn5zD4/1OmgweJt5vzGXW2ch7lrROEQhXB9lK+bjEeWx8TFW/+6ha/oRLnl6a2RBRL6mhwy3PoByNTKndB2MP4TygCJ/Ini4ivk74iSqVnoeuNJR/xUcU+kaIpZEIjxpAS2VECJU9fZvS5Gt84e5wl/t7bUKu+dlh/cUgHfk6+6bwzqGQYOe5A==' }
    };
    const localiv = 'LO2c/xLVb32/2VZTHlsSzw==';
    const ciphertext = Buffer.from('5+HKE91MbYyTbkP9vktH749GQ+j4y6tj3ArEl3Z9YRmMl5T2oGpvvAA5rLQZRfroyNuKbvjw/6qnYU7LgbgHDA==', 'base64');

    it('should successfully decrypt data encrypted through ursa @slow', () =>
      getLocalDecipherer(keys, 'topsecret').then((decipherer) => {
        const decipher = decipherer(localiv);
        const unencrypted = decipher.update(ciphertext, null, 'utf8') + decipher.final('utf8');

        unencrypted.should.equal('a way a lone a last a loved a long the riverrun,');
      }));
  });
});

