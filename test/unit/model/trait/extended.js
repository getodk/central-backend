const should = require('should');
const Instance = require('../../../../lib/model/instance/instance');
const { ExtendedInstance, HasExtended } = require('../../../../lib/model/trait/extended');

describe('ExtendedInstance/HasExtended', () => {
  // convenience test helper that completes the dependency injection shuffle-dance.
  const complete = (partial, container = {}) => {
    let result;
    partial((instance) => { result = instance; })(container);
    return result;
  };

  it('should add an Extended property containing a subclass', () => {
    const ExtendedBase = ExtendedInstance({});
    const SimpleBase = complete(Instance.with(HasExtended(ExtendedBase))()(() => class {}));

    const extended = new SimpleBase.Extended();
    extended.should.be.an.instanceOf(SimpleBase.Extended);
    extended.should.be.an.instanceOf(SimpleBase);
  });

  it('should leave all methods alone except forApi', () => {
    const ExtendedBase = ExtendedInstance({
      forApi() { return 42; }
    });
    const SimpleBase = complete(Instance.with(HasExtended(ExtendedBase))()(() => class {
      test() { return 10; }
      other() { return 20; }
      forApi() { return 30; }
    }));

    const extended = new SimpleBase.Extended();
    extended.test().should.equal(10);
    extended.other().should.equal(20);
    extended.forApi().should.equal(42);
  });

  it('should leave forApi alone if not provided', () => {
    const ExtendedBase = ExtendedInstance({});
    const SimpleBase = complete(Instance.with(HasExtended(ExtendedBase))()(() => class {
      test() { return 10; }
      other() { return 20; }
      forApi() { return 30; }
    }));

    const extended = new SimpleBase.Extended();
    extended.test().should.equal(10);
    extended.other().should.equal(20);
    extended.forApi().should.equal(30);
  });

  it('should override fields if given', () => {
    const ExtendedBase = ExtendedInstance({
      fields: { readable: [ 'extended', 'base', 'fields' ] }
    });
    const SimpleBase = complete(Instance.with(HasExtended(ExtendedBase))(null, {
      readable: [ 'base', 'fields' ]
    })(() => class {}));

    SimpleBase.Extended.fields.readable.should.eql([ 'extended', 'base', 'fields' ]);
  });

  it('should never override fields.all', () => {
    const ExtendedBase = ExtendedInstance({
      fields: { all: [ 'extended', 'base', 'fields' ] }
    });
    const SimpleBase = complete(Instance.with(HasExtended(ExtendedBase))(null, {
      all: [ 'base', 'fields' ]
    })(() => class {}));

    SimpleBase.Extended.fields.all.should.eql([ 'base', 'fields' ]);
  });

  it('should leave fields alone if not provided', () => {
    const ExtendedBase = ExtendedInstance({});
    const SimpleBase = complete(Instance.with(HasExtended(ExtendedBase))(null, {
      all: [ 'base', 'fields' ]
    })(() => class {}));

    SimpleBase.Extended.fields.all.should.eql([ 'base', 'fields' ]);
  });
});



