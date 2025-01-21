const R = require('ramda');
const Should = require('should');
const Option = require('../../../lib/util/option');

describe('(libs/FP) Option type', () => {
  it('Can be obtained from a value', () => {
    Option.of(33).should.be.instanceOf(Option);
  });

  it('Can be obtained from another Option and its value gets flatmapped', () => {
    Option.of(Option.of(33)).should.deepEqual(Option.of(33));
  });

  it('Can be obtained from null', () => {
    Option.of(null).should.be.instanceOf(Option);
  });

  it('A None can be obtained directly', () => {
    Option.none().should.be.instanceOf(Option);
  });

  describe('firstDefined', () => {
    it('Will give you first defined if it exists', () => {
      Option.firstDefined([ Option.none(), Option.none(), Option.of(42), Option.of(16) ])
        .should.deepEqual(Option.of(42));
    });

    it('Will give you none if none exists', () => {
      Option.firstDefined([ Option.none(), Option.none(), Option.none() ])
        .should.deepEqual(Option.none());
    });
  });

  context('Holding something', () => {
    const o = Option.of(33);

    it('Can be mapped over', () => {
      o.map(n => n + n).should.deepEqual(Option.of(66));
    });
    it('Can be filtered to something', () => {
      o.filter(x => x === 33).should.deepEqual(Option.of(33));
    });
    it('Can be filtered to nothing', () => {
      o.filter(() => false).should.equal(Option.of(null));
    });
    describe('Getting its value', () => {
      it('get() returns its value', () => {
        o.get().should.equal(33);
      });
      it('orNull() returns its value', () => {
        o.orNull().should.equal(33);
      });
      it('orElse(defaultValue) returns its value', () => {
        o.orElse(44).should.equal(33);
      });
      it('orElseGet(provider) returns its value', () => {
        o.orElseGet(() => 44).should.equal(33);
      });
      it("orThrow(err) returns its value and won't throw", () => {
        o.orThrow("you shouldn't see this error").should.equal(33);
      });
    });
    it('Calls a consumer ifDefined', (done) => {
      o.ifDefined((x) => {
        x.should.equal(33);
        done();
      });
    });
    it('It is not empty / It is defined', () => {
      o.isDefined().should.be.true();
      o.isEmpty().should.be.false();
    });
  });

  context('Holding nothing', () => {
    const o = Option.none();
    it('All None are referentially equal', () => {
      o.should.equal(Option.of(null));
    });
    it('Mapping over it has no effect', () => {
      o.map(n => n + n).should.deepEqual(o);
    });
    it('Can only be filtered to nothing', () => {
      o.filter(() => true).should.equal(Option.of(null));
    });
    describe('Getting its value', () => {
      it('get() throws error', () => {
        (() => o.get()).should.throw(/Option value not present on get/);
      });
      it('orNull() returns null', () => {
        Should(o.orNull()).be.null();
      });
      it('orElse(defaultValue) returns the given default value', () => {
        o.orElse(44).should.equal(44);
      });
      it('orElseGet(provider) returns the value returned by the provider fn', () => {
        o.orElseGet(() => 44).should.equal(44);
      });
      it('orThrow(err) throws', () => {
        (() => o.orThrow(new Error("you shouldn't see this error"))).should.throw("you shouldn't see this error");
      });
    });
    it('Does nothing ifDefined', () => {
      let called = false;
      o.ifDefined(() => { called = true; });
      called.should.equal(false);
    });
    it('It is not empty / It is defined', () => {
      o.isDefined().should.be.false();
      o.isEmpty().should.be.true();
    });
  });

  describe('ramda interactions', () => {
    describe('R.equals()', () => {
      it('Option.none() should equal Option.none()', () => {
        R.equals(Option.none(), Option.none()).should.be.true();
      });

      it('Option.of(...) should equal Option.of(...) the same value', () => {
        R.equals(Option.of(1), Option.of(1)).should.be.true();
      });

      [
        [ Option.none(), Option.of(0) ],
        [ Option.of(''), Option.of(0) ],
        [ Option.of(0),  Option.of(1) ], // eslint-disable-line no-multi-spaces
        [ Option.none(), null ],
        [ Option.none(), undefined ],
        [ Option.none(), 0 ],
        [ Option.none(), false ],
        [ Option.of(1),  1 ], // eslint-disable-line no-multi-spaces
        [ Option.of(1),  { value: 1 } ], // eslint-disable-line no-multi-spaces
      ].forEach(([a, b]) => {
        it(`${a} should not equal ${b}`, () => {
          R.equals(a, b).should.be.false();
          R.equals(b, a).should.be.false();
        });
      });
    });

    describe('R.isEmpty()', () => {
      it('Option.none() should be considered empty', () => {
        R.isEmpty(Option.none()).should.be.true();
      });

      it('Option.of(...) should NOT be considered empty', () => {
        R.isEmpty(Option.of(1)).should.be.false();
      });
    });
  });

  describe('assertion library interactions', () => {
    // N.B. should.equal() is different from should.eql():
    //
    // * .equal(): check equality using ===
    // * .eql():   check equality using "should-equal" module
    //
    // See: https://www.npmjs.com/package/should-equal

    // TODO re-introduce this line when chai is added to the project
    //const chaiAssert = require('chai').assert;
    const nodeAssert = require('node:assert');

    describe('equality', () => {
      [
        true,
        false,
        0,
        1,
        '',
        'non-empty string',
      ].forEach(val => {
        it(`should.js should recognise two Options of '${val}' to be equal`, () => {
          Option.of(val).should.eql(Option.of(val));
        });

        // TODO enable this test when chai is introduced to the project
        //it(`chai should recognise two Options of '${val}' to be equal`, () => {
        //  chaiAssert.deepEqual(Option.of(val), Option.of(val));
        //});

        it(`node:assert should recognise two Options of '${val}' to be equal`, () => {
          nodeAssert.deepStrictEqual(Option.of(val), Option.of(val));
        });
      });

      [
        [ 0, 1 ],
        [ 0, false ],
        [ 0, '' ],
        [ false, '' ],
      ].forEach((a, b) => {
        it(`should.js should not recognise Options of '${a}' and '${b}' as equal`, () => {
          Option.of(a).should.not.eql(Option.of(b));
        });

        // TODO enable this test when chai is introduced to the project
        //it(`chai should not recognise Options of '${a}' and '${b}' as equal`, () => {
        //  chaiAssert.notDeepEqual(Option.of(a), Option.of(b));
        //});

        it(`node:assert should not recognise Options of '${a}' and '${b}' as equal`, () => {
          nodeAssert.notDeepStrictEqual(Option.of(a), Option.of(b));
        });
      });
    });
  });
});
