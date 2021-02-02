const should = require('should');
const appRoot = require('app-root-path');
const { Frame, table, readable, writable } = require(appRoot + '/lib/model/frame');

describe('Frame', () => {
  it('should be immutable', () => {
    should.throws(() => {
      'use strict';
      (new Frame()).x = 42;
    });
  });

  it('should accept data into itself via constructor', () => {
    const instance = (new Frame({ x: 2, y: 3 }));
    instance.x.should.equal(2);
    instance.y.should.equal(3);
  });

  it('should by default populate writable fields from api', () => {
    const data = { x: 2, y: 3, z: 4 };
    const WritableInstance = Frame.define('a', writable, 'y', writable);
    WritableInstance.fromApi(data).should.eql(new WritableInstance({ y: 3 }));
  });

  it('should by default return readable fields for api', () => {
    const data = { x: 2, y: 3, z: 4 };
    const ReadableInstance = Frame.define('x', readable, 'z', readable);
    (new ReadableInstance(data)).forApi().should.eql({ x: 2, z: 4 });
  });

  it('should merge additional data into a new instance via with', () => {
    const a = new Frame({ x: 2 });
    a.with({ y: 3 }).should.eql(new Frame({ x: 2, y: 3 }));
    a.should.eql(new Frame({ x: 2 }));
  });
});

