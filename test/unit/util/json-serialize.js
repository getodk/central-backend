const should = require('should');
const appRoot = require('app-root-path');
const jsonSerialize = require(appRoot + '/lib/util/json-serialize');

describe('util/json-serialize', () => {
  it('should convert nullish values to valid JSON', () => {
    should(jsonSerialize(null)).equal('null');
    should(jsonSerialize(undefined)).equal('null');
  });

  it('should call forApi on the target if it exists', () => {
    jsonSerialize({ forApi: () => 42 }).should.eql('42');
  });

  it('should convert strings to valid JSON', () => {
    jsonSerialize('hello').should.equal('"hello"');
  });

  it('should jsonify any other values it finds', () => {
    jsonSerialize(42).should.equal('42');
    jsonSerialize({ x: 1 }).should.equal('{"x":1}');
  });

  it('should subserialize each element if an array is found', () => {
    jsonSerialize([
      'hello',
      { forApi: () => 42 },
      [ 'world',
        { forApi: () => 23 } ]
    ]).should.eql('["hello",42,["world",23]]');
  });

  it('should not subserialize plain objects within an array', () => {
    jsonSerialize([{ a: 1 }, { b: 2, c: 3 }]).should.eql('[{"a":1},{"b":2,"c":3}]');
  });
});
