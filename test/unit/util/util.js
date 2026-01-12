const util = require('../../../lib/util/util');

describe('util/util', () => {
  describe('isBlank', () => {
    const { isBlank } = util;
    it('should return true for nonexistentish values', () => {
      isBlank(null).should.equal(true);
      isBlank(undefined).should.equal(true);
      isBlank('').should.equal(true);
    });

    it('should return false for existentish values', () => {
      isBlank(' ').should.equal(false);
      isBlank(0).should.equal(false);
      isBlank(false).should.equal(false);
    });
  });

  describe('printPairs', () => {
    // testing here is light as this is only ever used to format debug text.
    const { printPairs } = util;
    it('should print a simple representation of a shallow dictionary', () => {
      printPairs({ a: 1, b: 'test', c: null }).should.equal("a: 1, b: 'test', c: null");
    });
  });

  describe('omit()', () => {
    const { omit } = util;

    it('should remove the specified keys', () => {
      omit([ 'b', 'd' ], { a: 1, b: 2, c: 3, d: 4, e: 5 }).should.eql({ a: 1, c: 3, e: 5 });
    });

    it('should actually remove the keys', () => {
      // eslint-disable-next-line no-prototype-builtins
      omit([ 'b' ], { a: 1, b: 2 }).hasOwnProperty('b').should.equal(false);
    });

    it('should not touch or reify prototype keys', () => {
      const x = { a: 1, b: 2 };
      const y = Object.create(x);
      y.c = 3;

      omit([ 'a' ], y).should.eql({ c: 3 });
      y.a.should.equal(1);
    });

    it('should do nothing given no keys or no obj', () => {
      omit([], { a: 1 }).should.eql({ a: 1 });
      omit([ 'test' ]).should.eql({});
    });
  });

  describe('blankStringToNull', () => {
    const { blankStringToNull } = util;
    it('should crush blank strings', () => {
      (blankStringToNull('') === null).should.equal(true);
    });

    it('should leave everything else alone', () => {
      (blankStringToNull(undefined) === undefined).should.equal(true);
      (blankStringToNull(null) === null).should.equal(true);
      (blankStringToNull(' ') === ' ').should.equal(true);
    });
  });

  describe('UTF-8 and Base64 conversion', () => {
    const { utf8ToBase64, base64ToUtf8 } = util;
    it('should convert unicode to base64', () => {
      const input = 'a Ā 𐀀 文 🦄';
      const base64 = utf8ToBase64(input);
      base64ToUtf8(base64).should.be.eql(input);
    });

    describe('base64ToUtf8()', () => {
      it(`should throw if no arg supplied`, () => {
        (() => base64ToUtf8()).should.throw('Invalid base64 string.');
      });

      [
        undefined,
        null,
        '!',
      ].forEach(malformed64 => {
        it(`should reject malformed input '${malformed64}'`, () => {
          (() => base64ToUtf8(malformed64)).should.throw('Invalid base64 string.');
        });
      });

      [
        [ '', '' ],
        [ '   ', '' ],
        [ 'c29tZSB0ZXh0',   'some text' ], // eslint-disable-line no-multi-spaces
        [ 'c29tZSB0ZXh0 ',  'some text' ], // eslint-disable-line no-multi-spaces
        [ ' c29tZSB0ZXh0 ', 'some text' ],
        [ 'c29tZSB0ZXh0IA',   'some text ' ], // eslint-disable-line no-multi-spaces
        [ 'c29tZSB0ZXh0IA=',  'some text ' ], // eslint-disable-line no-multi-spaces
        [ 'c29tZSB0ZXh0IA==', 'some text ' ],
        [ 'c29tZSB0ZXh0IDE=', 'some text 1' ],
        [ 'c29tZSB0ZXh0IDEx', 'some text 11' ],
      ].forEach(([ good64, expected ]) => {
        it(`should decode '${good64}' to '${expected}'`, () => {
          base64ToUtf8(good64).should.equal(expected);
        });
      });
    });
  });
});

