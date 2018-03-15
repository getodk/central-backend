const should = require('should');
const { DateTime } = require('luxon');
const { validate } = require('fast-xml-parser');

should.Assertion.add('isoDate', function() {
  this.params = { operator: 'to be an ISO date string' };
  DateTime.fromISO(this.obj).isValid.should.equal(true);
});

should.Assertion.add('recentIsoDate', function() {
  this.params = { operator: 'to be a recent ISO date string' };
  this.obj.should.be.an.isoDate();
  DateTime.fromISO(this.obj).plus({ minutes: 2 }).should.be.greaterThan(DateTime.local());
});

should.Assertion.add('token', function(length = 64) {
  this.params = { operator: 'to be a token string' };
  this.obj.should.match(new RegExp(`^[a-z0-9!$]{${length}}$`, 'i'));
});

should.Assertion.add('uuid', function() {
  this.params = { operator: 'to be a uuid string' };
  this.obj.should.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

should.Assertion.add('md5Sum', function() {
  this.params = { operator: 'to be an md5 sum string' };
  this.obj.should.match(/^[0-9a-f]{32}$/i);
});

should.Assertion.add('base64string', function() {
  this.params = { operator: 'to be an base64 string' };
  this.obj.should.match(/^[0-9a-z/+=]+$/i);
});

should.Assertion.add('Actor', function() {
  this.params = { operator: 'to be an Actor' };

  Object.keys(this.obj).should.containDeep([ 'createdAt', 'displayName', 'id', 'meta', 'updatedAt' ]);
  this.obj.id.should.be.a.Number();
  this.obj.displayName.should.be.a.String();
  this.obj.createdAt.should.be.an.isoDate();
  if (this.obj.updatedAt != null) this.obj.updatedAt.should.be.an.isoDate();
});

should.Assertion.add('User', function() {
  this.params = { operator: 'to be a User' };

  this.obj.should.be.an.Actor();
  Object.keys(this.obj).should.containDeep([ 'email' ]);
  this.obj.email.should.be.a.String();
});

const assertSubmissionBase = (obj) => {
  Object.keys(obj).should.containDeep([ 'formId', 'instanceId', 'xml', 'createdAt', 'updatedAt', 'submitter' ]);
  obj.formId.should.be.a.Number();
  obj.instanceId.should.be.a.String();
  obj.xml.should.be.a.String();
  validate(obj.xml).should.equal(true);
  obj.createdAt.should.be.an.isoDate();
  if (obj.updatedAt != null) obj.updatedAt.should.be.an.isoDate();
};

should.Assertion.add('Submission', function() {
  this.params = { operator: 'to be a Submission' };

  assertSubmissionBase(this.obj);
  this.obj.submitter.should.be.a.Number();
});

should.Assertion.add('ExtendedSubmission', function() {
  this.params = { operator: 'to be an extended Submission' };

  assertSubmissionBase(this.obj);
  this.obj.submitter.should.be.an.Actor();
});

should.Assertion.add('Session', function() {
  this.params = { operator: 'to be a Session' };

  Object.keys(this.obj).should.containDeep([ 'expiresAt', 'createdAt', 'token' ]);
  this.obj.expiresAt.should.be.an.isoDate();
  this.obj.createdAt.should.be.an.isoDate();
  this.obj.token.should.be.a.token();
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

should.Assertion.add('Form', function() {
  this.params = { operator: 'to be a Form' };

  Object.keys(this.obj).should.containDeep([ 'xmlFormId', 'xml', 'createdAt', 'updatedAt', 'name', 'version', 'hash' ]);
  this.obj.xmlFormId.should.be.a.String();
  this.obj.xml.should.be.a.String();
  validate(this.obj.xml).should.equal(true);
  this.obj.createdAt.should.be.an.isoDate();
  if (this.obj.updatedAt != null) this.obj.updatedAt.should.be.an.isoDate();
  if (this.obj.name != null) this.obj.name.should.be.a.String();
  if (this.obj.version != null) this.obj.version.should.be.a.String();
  this.obj.hash.should.be.an.md5Sum();
});

should.Assertion.add('ExtendedForm', function() {
  this.params = { operator: 'to be a ExtendedForm' };

  this.obj.should.be.a.Form();
  Object.keys(this.obj).should.containDeep([ 'submissions', 'lastSubmission' ]);
  if (this.obj.submissions != null) this.obj.submissions.should.be.a.Number();
  if (this.obj.lastSubmission != null) this.obj.lastSubmission.should.be.an.isoDate();
});

