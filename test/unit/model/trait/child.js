const should = require('should');
const Instance = require('../../../../lib/model/instance/instance');
const ChildTrait = require('../../../../lib/model/trait/child');

describe('ChildTrait', () => {
  // convenience test helper that completes the dependency injection shuffle-dance.
  const complete = (partial, container = {}) => {
    partial[1](container);
    return partial[0];
  };

  const SimpleClass = () => class {};
  const SimpleParent = complete(Instance()(SimpleClass));
  const SimpleChild = complete(Instance.with(ChildTrait('Parent'))()(SimpleClass), { Parent: SimpleParent });

  it('should change parent instance to parentId on forCreate', () => {
    const instance = new SimpleChild({ parent: new SimpleParent({ id: 23, a: 0 }), x: 1, y: 2 });
    instance.forCreate().should.eql(new SimpleChild({ parentId: 23, x: 1, y: 2 }));
  });

  it('should drop the parent entirely on forUpdate', () => {
    const instance = new SimpleChild({ parent: new SimpleParent({ id: 23, a: 0 }), x: 1, y: 2 });
    instance.forUpdate().should.eql(new SimpleChild({ x: 1, y: 2 }));
  });

  it('should merge parents on with', () => {
    const a = new SimpleChild({ parent: new SimpleParent({ id: 23, a: 0, b: 1 }), x: 1, y: 2 });
    const b = new SimpleChild({ parent: new SimpleParent({ id: 23, a: 4 }), x: 9, z: 7 });
    a.with(b).should.eql(new SimpleChild({ parent: new SimpleParent({ id: 23, a: 4, b: 1 }), x: 9, y: 2, z: 7 }));
  });

  it('should deal asymmetric parent nullness on with', () => {
    const a = new SimpleChild({ parent: new SimpleParent({ id: 23, a: 0 }), x: 1, y: 2 });
    const b = new SimpleChild({ x: 4, y: 2, z: 1 });

    a.with(b).should.eql(new SimpleChild({ parent: new SimpleParent({ id: 23, a: 0 }), x: 4, y: 2, z: 1 }));
    b.with(a).should.eql(new SimpleChild({ parent: new SimpleParent({ id: 23, a: 0 }), x: 1, y: 2, z: 1 }));
  });

  it('should deal with parentless instances on with', () => {
    const a = new SimpleChild({ x: 1, y: 2 });
    const b = new SimpleChild({ x: 4, y: 2, z: 1 });

    a.with(b).should.eql(new SimpleChild({ x: 4, y: 2, z: 1 }));
  });

  describe('API/database serialization', () => {
    const Parent = complete(Instance(null, {
      all: [ 'a', 'b', 'c' ],
      readable: [ 'a', 'c' ],
      writable: [ 'b', 'c' ]
    })(SimpleClass));

    const Child = complete(Instance.with(ChildTrait('Parent'))(null, {
      all: [ 'x', 'y', 'z' ],
      readable: [ 'y' ],
      writable: [ 'x', 'z' ]
    })(SimpleClass), { Parent });

    it('should merge self and parent readable fields on forApi', () => {
      const instance = new Child({ parent: new Parent({ a: 1, b: 2, c: 3, d: 4 }), x: 5, y: 6, z: 7 });
      instance.forApi().should.eql({ a: 1, c: 3, y: 6 });
    });

    it('should detangle self and parent writable fields on fromApi', () => {
      const inflated = Child.fromApi({ a: 4, b: 8, c: 15, d: 16, x: 23, y: 42, z: 108 });
      inflated.should.eql(new Child({ parent: new Parent({ b: 8, c: 15 }), x: 23, z: 108 }));
    });

    it('should detangle self and parent all fields on fromData', () => {
      const inflated = Child.fromData({ a: 4, b: 8, c: 15, d: 16, x: 23, y: 42, z: 108, omega: 1024 });
      inflated.should.eql(new Child({ parent: new Parent({ a: 4, b: 8, c: 15 }), x: 23, y: 42, z: 108 }));
    });
  });
});


