const should = require('should');
const appRoot = require('app-root-path');
const { sql } = require('slonik');
const { Frame, table, readable, writable, into, aux, embedded } = require(appRoot + '/lib/model/frame');
const Option = require(appRoot + '/lib/util/option');

describe('Frame', () => {
  describe('definition', () => {
    it('should accept fields', () => { Frame.define('a', 'b').fields.should.eql([ 'a', 'b' ]); });
    it('should create a fieldlist', () => {
      const { fieldlist } = Frame.define('a', 'b');
      sql`${fieldlist}`.should.eql(sql`"a","b"`);
    });
    it('should note readables', () => {
      Frame.define('a', writable, readable, 'b', 'c', readable).def.readable.should.eql([ 'a', 'c' ]);
    });
    it('should note writables', () => {
      Frame.define('a', readable, writable, 'b', writable, 'c').def.writable.should.eql([ 'a', 'b' ]);
    });
    it('should note insert fields and list', () => {
      const Box = Frame.define('id', 'a', readable, writable, 'b', writable, 'c');
      Box.insertfields.should.eql([ 'a', 'b', 'c' ]);
      sql`${Box.insertlist}`.should.eql(sql`"a","b","c"`);
    });
    it('should note hasCreatedAt and hasUpdatedAt', () => {
      const T = Frame.define('updatedAt');
      T.hasUpdatedAt.should.equal(true);
      T.hasCreatedAt.should.equal(false);
      const U = Frame.define('createdAt');
      U.hasUpdatedAt.should.equal(false);
      U.hasCreatedAt.should.equal(true);
    });
    it('should alias from and to', () => {
      const Box = Frame.define(table('frames')).alias('x', 'y');
      Box.from.should.equal('x');
      Box.to.should.equal('y');
    });
    it('should set into', () => {
      const Box = Frame.define(table('frames')).into('y');
      Box.from.should.equal('frames');
      Box.to.should.equal('y');
    });
  });

  describe('instance', () => {
    it('should be immutable', () => {
      should.throws(() => {
        // eslint-disable-next-line lines-around-directive, strict
        'use strict';
        (new Frame()).x = 42;
      });
    });

    it('should accept data into itself via constructor', () => {
      const instance = (new Frame({ x: 2, y: 3 }));
      instance.x.should.equal(2);
      instance.y.should.equal(3);
    });

    it('should accept aux data via constructor', () => {
      const instance = new Frame({ x: 2, y: 3 }, { z: 4 });
      instance.aux.z.should.equal(4);
    });

    it('should by default return readable fields for api', () => {
      const data = { x: 2, y: 3, z: 4 };
      const Box = Frame.define('x', readable, 'z', readable);
      (new Box(data)).forApi().should.eql({ x: 2, z: 4 });
    });

    it('should by default merge aux fields for api', () => {
      const Box = Frame.define('w', readable, 'x', readable, 'z', readable);
      (new Box(
        { w: 1, x: 2, y: 3, z: 4 },
        { a: new Box({ w: 5 }, { b: new Box({ x: 6 }), c: new Frame({ z: 7 }) }) }) // eslint-disable-line function-paren-newline
      ).forApi().should.eql({ w: 5, x: 6, z: 4 });
    });

    it('should resolve options when merging aux fields for api', () => {
      const Box = Frame.define('w', readable, 'x', readable, 'z', readable);
      (new Box(
        { w: 1, x: 2, y: 3, z: 4 },
        { a: Option.of(new Box({ w: 5 }, { b: new Box({ x: 6 }), c: Option.none() })) }) // eslint-disable-line function-paren-newline
      ).forApi().should.eql({ w: 5, x: 6, z: 4 });
    });

    it('should include wholesale embedded aux frames for api', () => {
      const Box = Frame.define('x', readable, embedded('y'));
      (new Box({ x: 2 }, { y: new Box({ x: 3 }) })).forApi().should.eql({ x: 2, y: { x: 3 } });
    });

    it('should resolve options when including embedded frames for api', () => {
      const Box = Frame.define('x', readable, embedded('y'));
      (new Box({ x: 2 }, { y: Option.of(new Box({ x: 3 }, { y: Option.none() })) }))
        .forApi().should.eql({ x: 2, y: { x: 3, y: null } });
    });

    it('should by default populate writable fields from api', () => {
      const data = { x: 2, y: 3, z: 4 };
      const Box = Frame.define('a', writable, 'y', writable);
      Box.fromApi(data).should.eql(new Box({ y: 3 }));
    });

    it('should populate known aux frames from api', () => {
      const Inner = Frame.define(into('inner'), 'y', writable);
      const Box = Frame.define('w', writable, 'x', writable, 'y', 'z', aux(Inner));

      const inflated = Box.fromApi({ x: 2, y: 3, z: 4 });
      inflated.should.eql(new Box({ x: 2 }));
      inflated.aux.inner.should.eql(new Inner({ y: 3 }));
    });

    it('should merge additional data into a new instance via with', () => {
      const a = new Frame({ x: 2 });
      a.with({ y: 3 }).should.eql(new Frame({ x: 2, y: 3 }));
      a.should.eql(new Frame({ x: 2 }));
    });

    it('should merge an instance into a new instance via with', () => {
      const a = new Frame({ x: 2, y: 3 }, { a: new Frame({ m: 4, n: 5 }), b: new Frame({ b: 0 }) });
      const b = new Frame({ y: 6, z: 7 }, { a: new Frame({ n: 8, o: 9 }), c: new Frame({ p: 10 }) });

      const c = a.with(b);
      c.should.eql(new Frame({ x: 2, y: 6, z: 7 }));
      c.aux.a.should.eql({ m: 4, n: 8, o: 9 });
      c.aux.b.should.eql(new Frame({ b: 0 }));
      c.aux.c.should.eql({ p: 10 });
    });

    it('should include another aux frame with withAux', () => {
      const f1 = new Frame().withAux('x', new Frame({ a: 1 }));
      f1.should.eql(new Frame({}));
      f1.aux.x.should.eql(new Frame({ a: 1 }));

      const f2 = new Frame({}, { w: 42, x: 42 }).withAux('x', new Frame({ a: 1 }));
      f2.should.eql(new Frame({}));
      f2.aux.w.should.eql(42);
      f2.aux.x.should.eql(new Frame({ a: 1 }));
    });

    it('should merge another aux frame with auxWith', () => {
      const f = new Frame({}, { w: 42, x: new Frame({ b: 0 }) }).auxWith('x', new Frame({ a: 1 }));

      f.should.eql(new Frame({}));
      f.aux.w.should.eql(42);
      f.aux.x.should.eql(new Frame({ a: 1, b: 0 }));
    });
  });
});

