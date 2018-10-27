const should = require('should');
const container = require('../../../../lib/model/package');
const Option = require('../../../../lib/util/option');

describe('Grant', () => {
  describe('granting', () => {
    it('should accept an actee instance', (done) => {
      const result = [];
      const { Actor, Grant, Actee } = container.withDefaults(null, { queries: { grants: {
        allow: (...args) => () => { result.push(args); return Promise.resolve() }
      } } });

      Grant.grantToActor(new Actor({ id: 42 }), [ 'read', 'write' ], new Actee({ acteeId: 'abc' }))
        .then(() => {
          result.should.eql([
            [ 42, 'read', 'abc' ],
            [ 42, 'write', 'abc' ]
          ]);
          done();
        });
    });

    it('should accept an actee id', (done) => {
      const result = [];
      const { Actor, Grant } = container.withDefaults(null, { queries: { grants: {
        allow: (...args) => () => { result.push(args); return Promise.resolve() }
      } } });

      Grant.grantToActor(new Actor({ id: 23 }), [ 'read', 'write' ], 'abc')
        .then(() => {
          result.should.eql([
            [ 23, 'read', 'abc' ],
            [ 23, 'write', 'abc' ]
          ]);
          done();
        });
    });

    it('should accept a single verb', (done) => {
      const result = [];
      const { Actor, Grant } = container.withDefaults(null, { queries: { grants: {
        allow: (...args) => () => { result.push(args); return Promise.resolve() }
      } } });

      Grant.grantToActor(new Actor({ id: 23 }), [ '*' ], 'abc')
        .then(() => {
          result.should.eql([ [ 23, '*', 'abc' ] ]);
          done();
        });
    });
  });

  describe('checking', () => {
    it('should allow operations on oneself', (done) => {
      const { Actor, Grant, Actee } = container.withDefaults();
      Grant.can(new Actor({ acteeId: 'someone' }), 'read', new Actee({ acteeId: 'someone' }))
        .then((result) => {
          result.should.equal(true);
          done();
        });
    });

    it('should accept Option[Actor] without complaint', (done) => {
      const { Actor, Grant, Actee } = container.withDefaults();
      Grant.can(Option.of(new Actor({ acteeId: 'someone' })), 'read', new Actee({ acteeId: 'someone' }))
        .then((result) => {
          result.should.equal(true);
          done();
        });
    });

    it('should pass if grants are found', (done) => {
      const { Actor, Grant, Actee } = container.withDefaults(null, { queries: { grants: {
        getByTriple: (actor, verb, actee) => () => Promise.resolve([ {}, {} ])
      } } });
      Grant.can(new Actor(), 'read', new Actee())
        .then((result) => {
          result.should.equal(true);
          done();
        });
    });

    it('should fail if no grants are found', (done) => {
      const { Actor, Grant, Actee } = container.withDefaults(null, { queries: { grants: {
        getByTriple: (actor, verb, actee) => () => Promise.resolve([])
      } } });
      Grant.can(new Actor(), 'read', new Actee())
        .then((result) => {
          result.should.equal(false);
          done();
        });
    });
  });
});

