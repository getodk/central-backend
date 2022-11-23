const should = require('should');
const { DateTime } = require('luxon');

// debugging things.
// eslint-disable-next-line no-console
global.tap = (x) => { console.log(x); return x; };

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('httpDate', function() {
  this.params = { operator: 'to be an HTTP date string' };
  DateTime.fromHTTP(this.obj).isValid.should.equal(true);
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('isoDate', function() {
  this.params = { operator: 'to be an ISO date string' };
  DateTime.fromISO(this.obj).isValid.should.equal(true);
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('recentIsoDate', function() {
  this.params = { operator: 'to be a recent ISO date string' };
  this.obj.should.be.an.isoDate();
  DateTime.fromISO(this.obj).plus({ minutes: 2 }).should.be.greaterThan(DateTime.local());
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('recentDate', function() {
  this.params = { operator: 'to be a recent date instance' };
  DateTime.local().minus({ minutes: 1 }).toJSDate().should.be.lessThan(this.obj);
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('token', function(length = 64) {
  this.params = { operator: 'to be a token string' };
  this.obj.should.match(new RegExp(`^[a-z0-9!$]{${length}}$`, 'i'));
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('uuid', function() {
  this.params = { operator: 'to be a uuid string' };
  this.obj.should.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('md5Sum', function() {
  this.params = { operator: 'to be an md5 sum string' };
  this.obj.should.match(/^[0-9a-f]{32}$/i);
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('base64string', function() {
  this.params = { operator: 'to be a base64 string' };
  this.obj.should.match(/^[0-9a-z/+=]+$/i);
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('Actor', function() {
  this.params = { operator: 'to be an Actor' };

  Object.keys(this.obj).should.containDeep([ 'createdAt', 'displayName', 'id', 'updatedAt' ]);
  this.obj.id.should.be.a.Number();
  this.obj.displayName.should.be.a.String();
  this.obj.createdAt.should.be.an.isoDate();
  if (this.obj.updatedAt != null) this.obj.updatedAt.should.be.an.isoDate();

  should.not.exist(this.obj.acteeId);
  should.not.exist(this.obj.meta);
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('Comment', function() {
  this.params = { operator: 'to be a Comment' };

  Object.keys(this.obj).should.containDeep([ 'body', 'actorId', 'createdAt' ]);
  this.obj.body.should.be.a.String();
  this.obj.actorId.should.be.a.Number();
  this.obj.createdAt.should.be.an.isoDate();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('User', function() {
  this.params = { operator: 'to be a User' };

  this.obj.should.be.an.Actor();
  Object.keys(this.obj).should.containDeep([ 'email' ]);
  this.obj.email.should.be.a.String();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('Submission', function() {
  this.params = { operator: 'to be a Submission' };

  Object.keys(this.obj).should.containDeep([ 'instanceId', 'createdAt', 'updatedAt', 'submitterId' ]);
  this.obj.instanceId.should.be.a.String();
  this.obj.submitterId.should.be.a.Number();
  this.obj.createdAt.should.be.an.isoDate();
  if (this.obj.updatedAt != null) this.obj.updatedAt.should.be.an.isoDate();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('ExtendedSubmission', function() {
  this.params = { operator: 'to be an extended Submission' };

  Object.keys(this.obj).should.containDeep([ 'instanceId', 'createdAt', 'updatedAt', 'submitter' ]);
  this.obj.instanceId.should.be.a.String();
  this.obj.submitter.should.be.an.Actor();
  this.obj.createdAt.should.be.an.isoDate();
  if (this.obj.updatedAt != null) this.obj.updatedAt.should.be.an.isoDate();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('SubmissionDef', function() {
  this.params = { operator: 'to be a Submission' };

  Object.keys(this.obj).should.containDeep([ 'submitterId', 'createdAt', 'instanceName' ]);
  this.obj.submitterId.should.be.a.Number();
  this.obj.createdAt.should.be.an.isoDate();
  if (this.obj.instanceName != null) this.obj.instanceName.should.be.a.String();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('ExtendedSubmissionDef', function() {
  this.params = { operator: 'to be a Submission' };

  this.obj.should.be.a.SubmissionDef();
  this.obj.submitter.should.be.an.Actor();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('Session', function() {
  this.params = { operator: 'to be a Session' };

  Object.keys(this.obj).should.containDeep([ 'expiresAt', 'createdAt', 'token' ]);
  this.obj.expiresAt.should.be.an.isoDate();
  this.obj.createdAt.should.be.an.isoDate();
  this.obj.token.should.be.a.token();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('FieldKey', function() {
  this.params = { operator: 'to be a Field Key' };

  should(this.obj).be.an.Actor();
  Object.keys(this.obj).should.containDeep([ 'token', 'projectId' ]);
  should.not.exist(this.obj.createdBy);
  this.obj.projectId.should.be.a.Number();
  if (this.obj.token != null) this.obj.token.should.be.a.token();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('ExtendedFieldKey', function() {
  this.params = { operator: 'to be an Extended Field Key' };

  should(this.obj).be.an.Actor();
  Object.keys(this.obj).should.containDeep([ 'createdBy', 'token', 'projectId' ]);
  this.obj.createdBy.should.be.an.Actor();
  this.obj.should.have.property('lastUsed');
  this.obj.projectId.should.be.a.Number();
  if (this.obj.lastUsed != null) this.obj.lastUsed.should.be.an.isoDate();
  if (this.obj.token != null) this.obj.token.should.be.a.token();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('PublicLink', function() {
  this.params = { operator: 'to be a Public Link' };

  should(this.obj).be.an.Actor();
  Object.keys(this.obj).should.containDeep([ 'token' ]);
  should.not.exist(this.obj.createdBy);
  if (this.obj.token != null) this.obj.token.should.be.a.token();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('ExtendedPublicLink', function() {
  this.params = { operator: 'to be an Extended Public Link' };

  should(this.obj).be.an.Actor();
  Object.keys(this.obj).should.containDeep([ 'createdBy', 'token' ]);
  this.obj.createdBy.should.be.an.Actor();
  if (this.obj.token != null) this.obj.token.should.be.a.token();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('Form', function() {
  this.params = { operator: 'to be a Form' };

  Object.keys(this.obj).should.containDeep([ 'projectId', 'xmlFormId', 'createdAt', 'updatedAt', 'name', 'version', 'hash' ]);
  this.obj.projectId.should.be.a.Number();
  this.obj.xmlFormId.should.be.a.String();
  this.obj.createdAt.should.be.an.isoDate();
  if (this.obj.updatedAt != null) this.obj.updatedAt.should.be.an.isoDate();
  if (this.obj.name != null) this.obj.name.should.be.a.String();
  if (this.obj.version != null) this.obj.version.should.be.a.String();
  this.obj.hash.should.be.an.md5Sum();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('ExtendedForm', function() {
  this.params = { operator: 'to be a ExtendedForm' };

  this.obj.should.be.a.Form();
  Object.keys(this.obj).should.containDeep([ 'submissions', 'lastSubmission', 'reviewStates' ]);
  this.obj.submissions.should.be.a.Number();
  Object.keys(this.obj.reviewStates).should.containDeep([ 'received', 'hasIssues', 'edited']);
  if (this.obj.lastSubmission != null) this.obj.lastSubmission.should.be.an.isoDate();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('FormAttachment', function() {
  this.params = { operator: 'to be a Form Attachment' };

  Object.keys(this.obj).should.eqlInAnyOrder([ 'name', 'type', 'blobExists', 'datasetExists', 'exists', 'updatedAt' ]);
  this.obj.name.should.be.a.String();
  this.obj.type.should.be.a.String();
  const { blobExists, datasetExists, exists } = this.obj;
  blobExists.should.be.a.Boolean();
  datasetExists.should.be.a.Boolean();
  (blobExists && datasetExists).should.be.false();
  exists.should.equal(blobExists || datasetExists);
  if (this.obj.updatedAt != null) this.obj.updatedAt.should.be.an.isoDate();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('Project', function() {
  this.params = { operator: 'to be a Project' };

  Object.keys(this.obj).should.containDeep([ 'id', 'name', 'createdAt', 'updatedAt' ]);
  this.obj.id.should.be.a.Number();
  this.obj.name.should.be.a.String();
  this.obj.createdAt.should.be.an.isoDate();
  if (this.obj.updatedAt != null) this.obj.updatedAt.should.be.an.isoDate();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('ExtendedProject', function() {
  this.params = { operator: 'to be a Project' };

  this.obj.should.be.a.Project();
  Object.keys(this.obj).should.containDeep([ 'forms', 'appUsers', 'lastSubmission' ]);
  this.obj.forms.should.be.a.Number();
  this.obj.appUsers.should.be.a.Number();
  if (this.obj.lastSubmission != null) this.obj.lastSubmission.should.be.an.isoDate();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('Role', function() {
  this.params = { operator: 'to be a Role' };

  Object.keys(this.obj).should.containDeep([ 'id', 'name', 'verbs', 'createdAt', 'updatedAt' ]);
  if (this.obj.system != null) this.obj.system.should.be.a.String();
  this.obj.verbs.should.an.Array();
  this.obj.verbs.forEach((verb) => verb.should.be.a.String());
  if (this.obj.createdAt != null) this.obj.createdAt.should.be.an.isoDate();
  if (this.obj.updatedAt != null) this.obj.updatedAt.should.be.an.isoDate();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('Audit', function() {
  this.params = { operator: 'to be an Audit' };

  Object.keys(this.obj).should.containDeep([ 'actorId', 'action', 'acteeId', 'details', 'loggedAt' ]);
  this.obj.actorId.should.be.a.Number();
  this.obj.action.should.be.a.String();
  if (this.obj.acteeId != null) this.obj.acteeId.should.be.a.uuid();
  this.obj.loggedAt.should.be.an.isoDate();

  should.not.exist(this.obj.claimed);
  should.not.exist(this.obj.processed);
  should.not.exist(this.obj.lastFailure);
  should.not.exist(this.obj.failures);

  if (this.obj.notes != null) this.obj.notes.should.be.a.String();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('Key', function() {
  this.params = { operator: 'to be an Key' };

  Object.keys(this.obj).should.containDeep([ 'hint', 'managed', 'public' ]);
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('Config', function() {
  this.params = { operator: 'to be a Config' };

  Object.keys(this.obj).should.containDeep([ 'key', 'value', 'setAt' ]);
  this.obj.key.should.be.a.String();
  this.obj.value.should.be.an.Object();
  this.obj.setAt.should.be.an.isoDate();
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('SimpleCsv', function() {
  this.params = { operator: 'to be a full simple.csv export with three rows' };

  const csv = this.obj.split('\n').map((row) => row.split(','));
  csv.length.should.equal(5); // header + 3 data rows + newline
  csv[0].should.eql([ 'SubmissionDate', 'meta-instanceID', 'name', 'age', 'KEY', 'SubmitterID', 'SubmitterName', 'AttachmentsPresent', 'AttachmentsExpected', 'Status', 'ReviewState', 'DeviceID', 'Edits', 'FormVersion' ]);
  csv[1].shift().should.be.an.recentIsoDate();
  // eslint-disable-next-line comma-spacing
  csv[1].should.eql([ 'three','Chelsea','38','three','5','Alice','0','0','','','','0', '' ]);
  csv[2].shift().should.be.an.recentIsoDate();
  // eslint-disable-next-line comma-spacing
  csv[2].should.eql([ 'two','Bob','34','two','5','Alice','0','0','','','','0', '' ]);
  csv[3].shift().should.be.an.recentIsoDate();
  // eslint-disable-next-line comma-spacing
  csv[3].should.eql([ 'one','Alice','30','one','5','Alice','0','0','','','','0', '' ]);
  csv[4].should.eql([ '' ]);
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('EncryptedSimpleCsv', function() {
  this.params = { operator: 'to be a full encrypted simple.csv export with three rows' };

  const csv = this.obj.split('\n').map((row) => row.split(','));
  csv.length.should.equal(5); // header + 3 data rows + newline
  csv[0].should.eql([ 'SubmissionDate', 'meta-instanceID', 'name', 'age', 'KEY', 'SubmitterID', 'SubmitterName', 'AttachmentsPresent', 'AttachmentsExpected', 'Status', 'ReviewState', 'DeviceID', 'Edits', 'FormVersion' ]);
  csv[1].shift().should.be.an.recentIsoDate();
  csv[1].pop().should.match(/^\[encrypted:........\]$/);
  // eslint-disable-next-line comma-spacing
  csv[1].should.eql([ 'three','Chelsea','38','three','5','Alice','1','1','','','','0' ]);
  csv[2].shift().should.be.an.recentIsoDate();
  csv[2].pop().should.match(/^\[encrypted:........\]$/);
  // eslint-disable-next-line comma-spacing
  csv[2].should.eql([ 'two','Bob','34','two','5','Alice','1','1','','','','0' ]);
  csv[3].shift().should.be.an.recentIsoDate();
  csv[3].pop().should.match(/^\[encrypted:........\]$/);
  // eslint-disable-next-line comma-spacing
  csv[3].should.eql([ 'one','Alice','30','one','5','Alice','1','1','','','','0' ]);
  csv[4].should.eql([ '' ]);
});

// eslint-disable-next-line space-before-function-paren, func-names
should.Assertion.add('eqlInAnyOrder', function(expectedUnsorted) {
  // eslint-disable-next-line key-spacing
  this.params = { operator:'to be equal in any order' };

  const actualSorted = [ ...this.obj ].sort();
  const expectedSorted = [ ...expectedUnsorted ].sort();
  actualSorted.should.eql(expectedSorted);
});
