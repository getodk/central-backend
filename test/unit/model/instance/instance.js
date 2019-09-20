const should = require('should');
const builder = require('../../../../lib/model/instance/instance');

describe('Instance', () => {
  // convenience test helper that completes the dependency injection shuffle-dance.
  const complete = (partial, container = {}) => {
    let result;
    partial((instance) => { result = instance; })(container);
    return result;
  };

  describe('builder', () => {
    it('should surface provided instance methods', () => {
      const Klass = complete(builder()(() => class {
        foo() { return 42; }
        bar(x) { return x * 2; }
      }));

      (new Klass()).foo().should.equal(42);
      (new Klass()).bar(2).should.equal(4);
    });

    it('should surface provided class methods', () => {
      const Klass = complete(builder()(() => class {
        static foo() { return 42; }
        static bar(x) { return x * 2; }
      }));

      Klass.foo().should.equal(42);
      Klass.bar(2).should.equal(4);
    });

    it('should provide the given container', () => {
      const Klass = complete(builder()((container) => class {
        foo() { return 2 * container; }
        static bar(x) { return x * container; }
      }), 3);

      (new Klass()).foo().should.equal(6);
      Klass.bar(3).should.equal(9);
    });

    it('should mix the given traits', () => {
      const Trait = (container) => class {
        static bar(x) { return x * 2; }
        baz(y) { return y * 3; }
      };
      const Klass = complete(builder.with(Trait)()((container) => class {
        foo() { return 42; }
      }));

      (new Klass()).foo().should.equal(42);
      Klass.bar(3).should.equal(6);
      (new Klass()).baz(4).should.equal(12);
    });

    it('should provide the container to traits', () => {
      const Trait = (container) => class {
        bar(x) { return x + container; }
      };
      const Klass = complete(builder.with(Trait)()((container) => class {}), 42);

      (new Klass()).bar(5).should.equal(47);
    });

    it('should clobber earlier instance methods with later ones', () => {
      const Trait1 = (container) => class {
        foo() { return 42; }
        bar(x) { return x * 2; }
        baz(y) { return y * 3; }
      };
      const Trait2 = (container) => class {
        bar(x) { return x * 4; }
        baz(y) { return y * 5; }
      };
      const Klass = complete(builder.with(Trait1, Trait2)()((container) => class {
        baz(y) { return y * 6; }
      }));

      (new Klass()).foo().should.equal(42);
      (new Klass()).bar(3).should.equal(12);
      (new Klass()).baz(4).should.equal(24);
    });

    it('should clobber earlier static methods with later ones', () => {
      const Trait1 = (container) => class {
        static foo() { return 42; }
        static bar(x) { return x * 2; }
        static baz(y) { return y * 3; }
      };
      const Trait2 = (container) => class {
        static bar(x) { return x * 4; }
        static baz(y) { return y * 5; }
      };
      const Klass = complete(builder.with(Trait1, Trait2)()((container) => class {
        static baz(y) { return y * 6; }
      }));

      Klass.foo().should.equal(42);
      Klass.bar(3).should.equal(12);
      Klass.baz(4).should.equal(24);
    });

    it('should decorate the given table information', () => {
      const Klass = complete(builder('mytable')(() => class {}));
      Klass.table.should.equal('mytable');
    });

    it('should decorate the given field information', () => {
      const Klass = complete(builder(null, {
        all: [ 'one', 'two', 'three' ],
        readable: [ 'one' ],
        writable: [ 'two' ]
      })(() => class {}));
      Klass.fields.all.should.eql([ 'one', 'two', 'three' ]);
      Klass.fields.readable.should.eql([ 'one' ]);
      Klass.fields.writable.should.eql([ 'two' ]);
    });
  });

  describe('instance', () => {
    const SimpleInstance = complete(builder()(() => class {}));
    it('should be immutable', () => {
      should.throws(() => {
        'use strict';
        (new SimpleInstance()).x = 42;
      });
    });

    it('should accept data into itself via constructor', () => {
      const instance = (new SimpleInstance({ x: 2, y: 3 }));
      instance.x.should.equal(2);
      instance.y.should.equal(3);
    });

    it('should by default return itself for creation', () => {
      const data = { x: 2, y: 3, z: 4 };
      const instance = new SimpleInstance(data);
      instance.forCreate().should.equal(instance);
    });

    it('should by default populate writable fields from api', () => {
      const data = { x: 2, y: 3, z: 4 };
      const WritableInstance = complete(builder(null, { writable: [ 'a', 'y' ] })(() => class {}));
      WritableInstance.fromApi(data).should.eql(new WritableInstance({ y: 3 }));
    });

    it('should by default populate all writable fields from api for put', () => {
      const data = { x: 2, y: 3, z: 4 };
      const WritableInstance = complete(builder(null, { writable: [ 'a', 'y' ] })(() => class {}));
      WritableInstance.fromApiForPut(data).should.eql(new WritableInstance({ a: null, y: 3 }));
    });

    it('should by default return readable fields for api', () => {
      const data = { x: 2, y: 3, z: 4 };
      const ReadableInstance = complete(builder(null, { readable: [ 'x', 'z' ] })(() => class {}));
      (new ReadableInstance(data)).forApi().should.eql({ x: 2, z: 4 });
    });

    it('should merge additional data into a new instance via with', () => {
      const a = new SimpleInstance({ x: 2 });
      a.with({ y: 3 }).should.eql(new SimpleInstance({ x: 2, y: 3 }));
      a.should.eql(new SimpleInstance({ x: 2 }));
    });

    it('should omit keys into a new instance via without', () => {
      const a = new SimpleInstance({ w: 1, x: 2, y: 3, z: 4 });
      a.without('w', 'y').should.eql(new SimpleInstance({ x: 2, z: 4 }));
      a.should.eql(new SimpleInstance({ w: 1, x: 2, y: 3, z: 4 }));
    });
  });
});

