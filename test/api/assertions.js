const should = require('should');
const { DateTime } = require('luxon');

should.Assertion.add('isoDate', function() {
  this.params = { operator: 'to be an ISO date string' };
  DateTime.fromISO(this.obj).isValid.should.equal(true);
});

should.Assertion.add('token', function() {
  this.params = { operator: 'to be a token string' };
  this.obj.should.match(/^[a-z0-9!+]{64}$/i);
});

should.Assertion.add('Actor', function() {
  this.params = { operator: 'to be an Actor' };

  Object.keys(this.obj).should.containDeep([ 'createdAt', 'displayName', 'id', 'meta', 'updatedAt' ]);
  this.obj.id.should.be.a.Number();
  this.obj.displayName.should.be.a.String();
  this.obj.createdAt.should.be.an.isoDate();
  if (this.obj.updatedAt != null) this.obj.updatedAt.should.be.an.isoDate();
});

should.Assertion.add('FieldKey', function() {
  this.params = { operator: 'to be a Field Key' };

  should(this.obj).be.an.Actor();
  Object.keys(this.obj).should.containDeep([ 'createdBy', 'token' ]);
  if (this.obj.token != null) this.obj.token.should.be.a.token();
});

should.Assertion.add('ExtendedFieldKey', function() {
  this.params = { operator: 'to be an Extended Field Key' };

  should(this.obj).be.a.FieldKey();
  this.obj.createdBy.should.be.an.Actor();
  this.obj.should.have.property('lastUsed');
  if (this.obj.lastUsed != null) this.obj.lastUsed.should.be.an.isoDate();
});

