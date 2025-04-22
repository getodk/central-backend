const should = require('should');
const { DateTime } = require('luxon');

// debugging things.
// eslint-disable-next-line no-console
global.tap = (x) => { console.log(x); return x; };

should.Assertion.add('httpDate', function() {
  this.params = { operator: 'to be an HTTP date string' };
  DateTime.fromHTTP(this.obj).isValid.should.equal(true);
});

should.Assertion.add('isoDate', function() {
  this.params = { operator: 'to be an ISO date string' };
  DateTime.fromISO(this.obj).isValid.should.equal(true);
});

should.Assertion.add('nullOrIsoDate', function() {
  this.params = { operator: 'to be null or an ISO date string' };
  if (this.obj != null) this.obj.should.be.an.isoDate();
});

should.Assertion.add('nullOrString', function() {
  this.params = { operator: 'to be null or string' };
  if (this.obj != null) this.obj.should.be.String();
});

should.Assertion.add('nullOrNumber', function() {
  this.params = { operator: 'to be null or number' };
  if (this.obj != null) this.obj.should.be.Number();
});

should.Assertion.add('nullOrArray', function() {
  this.params = { operator: 'to be null or array' };
  if (this.obj != null) this.obj.should.be.Array();
});

should.Assertion.add('nullOrObject', function() {
  this.params = { operator: 'to be null or object' };
  if (this.obj != null) this.obj.should.be.Object();
});

should.Assertion.add('recentIsoDate', function() {
  this.params = { operator: 'to be a recent ISO date string' };
  this.obj.should.be.an.isoDate();
  DateTime.fromISO(this.obj).plus({ minutes: 2 }).should.be.greaterThan(DateTime.local());
});

should.Assertion.add('recentDate', function() {
  this.params = { operator: 'to be a recent date instance' };
  DateTime.local().minus({ minutes: 1 }).toJSDate().should.be.lessThan(this.obj);
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
  this.params = { operator: 'to be a base64 string' };
  this.obj.should.match(/^[0-9a-z/+=]+$/i);
});

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

should.Assertion.add('Comment', function() {
  this.params = { operator: 'to be a Comment' };

  Object.keys(this.obj).should.containDeep([ 'body', 'actorId', 'createdAt' ]);
  this.obj.body.should.be.a.String();
  this.obj.actorId.should.be.a.Number();
  this.obj.createdAt.should.be.an.isoDate();
});

should.Assertion.add('User', function() {
  this.params = { operator: 'to be a User' };

  this.obj.should.be.an.Actor();
  Object.keys(this.obj).should.containDeep([ 'email' ]);
  this.obj.email.should.be.a.String();
});

should.Assertion.add('Submission', function() {
  this.params = { operator: 'to be a Submission' };

  Object.keys(this.obj).should.containDeep([ 'instanceId', 'createdAt', 'updatedAt', 'submitterId', 'currentVersion', 'userAgent' ]);
  this.obj.instanceId.should.be.a.String();
  this.obj.submitterId.should.be.a.Number();
  this.obj.createdAt.should.be.an.isoDate();
  if (this.obj.userAgent !== null) this.obj.userAgent.should.be.a.String();
  this.obj.currentVersion.should.be.a.SubmissionDef();
  if (this.obj.updatedAt != null) this.obj.updatedAt.should.be.an.isoDate();
});

should.Assertion.add('ExtendedSubmission', function() {
  this.params = { operator: 'to be an extended Submission' };

  Object.keys(this.obj).should.containDeep([ 'instanceId', 'createdAt', 'updatedAt', 'submitter', 'currentVersion' ]);
  this.obj.instanceId.should.be.a.String();
  this.obj.submitter.should.be.an.Actor();
  this.obj.createdAt.should.be.an.isoDate();
  this.obj.currentVersion.should.be.a.ExtendedSubmissionDef();
  if (this.obj.updatedAt != null) this.obj.updatedAt.should.be.an.isoDate();
});

should.Assertion.add('SubmissionDef', function() {
  this.params = { operator: 'to be a Submission' };

  Object.keys(this.obj).should.containDeep([ 'instanceId', 'submitterId', 'createdAt', 'instanceName', 'current', 'userAgent', 'deviceId' ]);
  this.obj.submitterId.should.be.a.Number();
  this.obj.createdAt.should.be.an.isoDate();
  if (this.obj.instanceName != null) this.obj.instanceName.should.be.a.String();
});

should.Assertion.add('ExtendedSubmissionDef', function() {
  this.params = { operator: 'to be a Submission' };

  this.obj.should.be.a.SubmissionDef();
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
  Object.keys(this.obj).should.containDeep([ 'token', 'projectId' ]);
  should.not.exist(this.obj.createdBy);
  this.obj.projectId.should.be.a.Number();
  if (this.obj.token != null) this.obj.token.should.be.a.token();
});

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

should.Assertion.add('PublicLink', function() {
  this.params = { operator: 'to be a Public Link' };

  should(this.obj).be.an.Actor();
  Object.keys(this.obj).should.containDeep([ 'token' ]);
  should.not.exist(this.obj.createdBy);
  if (this.obj.token != null) this.obj.token.should.be.a.token();
});

should.Assertion.add('ExtendedPublicLink', function() {
  this.params = { operator: 'to be an Extended Public Link' };

  should(this.obj).be.an.Actor();
  Object.keys(this.obj).should.containDeep([ 'createdBy', 'token' ]);
  this.obj.createdBy.should.be.an.Actor();
  if (this.obj.token != null) this.obj.token.should.be.a.token();
});

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

should.Assertion.add('ExtendedForm', function() {
  this.params = { operator: 'to be a ExtendedForm' };

  this.obj.should.be.a.Form();
  Object.keys(this.obj).should.containDeep([ 'submissions', 'lastSubmission', 'reviewStates', 'publicLinks' ]);
  this.obj.submissions.should.be.a.Number();
  Object.keys(this.obj.reviewStates).should.containDeep([ 'received', 'hasIssues', 'edited']);
  if (this.obj.lastSubmission != null) this.obj.lastSubmission.should.be.an.isoDate();
  this.obj.publicLinks.should.be.a.Number();
});

should.Assertion.add('FormAttachment', function() {
  this.params = { operator: 'to be a Form Attachment' };

  Object.keys(this.obj).should.be.a.subsetOf([ 'name', 'type', 'blobExists', 'datasetExists', 'exists', 'hash', 'updatedAt' ]);
  this.obj.name.should.be.a.String();
  this.obj.type.should.be.a.String();
  const { blobExists, datasetExists, exists, hash } = this.obj;
  blobExists.should.be.a.Boolean();
  datasetExists.should.be.a.Boolean();
  (blobExists && datasetExists).should.be.false();
  exists.should.equal(blobExists || datasetExists);
  (hash != null).should.equal(blobExists);
  if (hash != null) hash.should.be.an.md5Sum();
  if (this.obj.updatedAt != null) this.obj.updatedAt.should.be.an.isoDate();
});

should.Assertion.add('Problem', function() {
  this.params = { operator: 'to be a Problem' };

  this.obj.should.be.a.Error();
  Object.keys(this.obj).should.containDeep([ 'problemCode', 'problemDetails' ]);
  this.obj.problemCode.should.be.a.Number();
});

should.Assertion.add('Project', function() {
  this.params = { operator: 'to be a Project' };

  Object.keys(this.obj).should.containDeep([ 'id', 'name', 'createdAt', 'updatedAt' ]);
  this.obj.id.should.be.a.Number();
  this.obj.name.should.be.a.String();
  this.obj.createdAt.should.be.an.isoDate();
  if (this.obj.updatedAt != null) this.obj.updatedAt.should.be.an.isoDate();
});

should.Assertion.add('ExtendedProject', function() {
  this.params = { operator: 'to be a Project' };

  this.obj.should.be.a.Project();
  Object.keys(this.obj).should.containDeep([ 'forms', 'appUsers', 'lastSubmission' ]);
  this.obj.forms.should.be.a.Number();
  this.obj.appUsers.should.be.a.Number();
  if (this.obj.lastSubmission != null) this.obj.lastSubmission.should.be.an.isoDate();
});

should.Assertion.add('Role', function() {
  this.params = { operator: 'to be a Role' };

  Object.keys(this.obj).should.containDeep([ 'id', 'name', 'verbs', 'createdAt', 'updatedAt' ]);
  if (this.obj.system != null) this.obj.system.should.be.a.String();
  this.obj.verbs.should.an.Array();
  this.obj.verbs.forEach((verb) => verb.should.be.a.String());
  if (this.obj.createdAt != null) this.obj.createdAt.should.be.an.isoDate();
  if (this.obj.updatedAt != null) this.obj.updatedAt.should.be.an.isoDate();
});

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

should.Assertion.add('Key', function() {
  this.params = { operator: 'to be an Key' };

  Object.keys(this.obj).should.containDeep([ 'hint', 'managed', 'public' ]);
});

should.Assertion.add('Config', function() {
  this.params = { operator: 'to be a Config' };

  Object.keys(this.obj).should.containDeep([ 'key', 'value', 'setAt' ]);
  this.obj.key.should.be.a.String();
  this.obj.value.should.be.an.Object();
  this.obj.setAt.should.be.an.isoDate();
});

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

should.Assertion.add('eqlInAnyOrder', function(expectedUnsorted) {
  // eslint-disable-next-line key-spacing
  this.params = { operator:'to be equal in any order' };

  const actualSorted = [ ...this.obj ].sort();
  const expectedSorted = [ ...expectedUnsorted ].sort();
  actualSorted.should.eql(expectedSorted);
});

should.Assertion.add('subsetOf', function(array) {
  this.params = { operator: 'to be a subset of' };

  this.obj.should.be.an.Array();
  for (const x of this.obj) array.should.containEql(x);
});

should.Assertion.add('Dataset', function assertDataset() {
  this.params = { operator: 'to be a Dataset' };

  Object.keys(this.obj).should.containDeep([ 'projectId', 'name', 'createdAt' ]);
  this.obj.projectId.should.be.a.Number();
  this.obj.name.should.be.a.String();
  this.obj.createdAt.should.be.an.isoDate();
});

should.Assertion.add('ExtendedDataset', function assertExtendedDataset() {
  this.params = { operator: 'to be an extended Dataset' };

  this.obj.should.be.a.Dataset();
  Object.keys(this.obj).should.containDeep([ 'entities', 'lastEntity', 'conflicts' ]);
  this.obj.entities.should.be.a.Number();
  if (this.obj.lastEntity != null) this.obj.lastEntity.should.be.an.isoDate();
});

should.Assertion.add('Entity', function assertEntity() {
  this.params = { operator: 'to be an Entity' };

  this.obj.should.have.property('uuid').which.is.a.String();
  this.obj.should.have.property('createdAt').which.is.a.isoDate();
  this.obj.should.have.property('updatedAt').which.is.nullOrIsoDate();
  this.obj.should.have.property('deletedAt').which.is.nullOrIsoDate();
  this.obj.should.have.property('creatorId').which.is.a.Number();
});

should.Assertion.add('ExtendedEntity', function assertEntity() {
  this.params = { operator: 'to be an Extended Entity' };

  this.obj.should.be.an.Entity();
  this.obj.should.have.property('creator').which.is.an.Actor();
});

should.Assertion.add('EntityDef', function assertEntityDef() {
  this.params = { operator: 'to be an Entity Def (version)' };


  this.obj.should.have.property('label').which.is.a.String();
  this.obj.should.have.property('current').which.is.a.Boolean();
  this.obj.should.have.property('createdAt').which.is.a.isoDate();
  this.obj.should.have.property('creatorId').which.is.a.Number();
  this.obj.should.have.property('version').which.is.a.Number();
  this.obj.should.have.property('baseVersion').which.is.nullOrNumber();
  this.obj.should.have.property('conflictingProperties').which.is.nullOrArray();
  if (this.obj.userAgent !== null) this.obj.userAgent.should.be.a.String();
});

should.Assertion.add('ExtendedEntityDef', function assertEntity() {
  this.params = { operator: 'to be an Extended Entity Def (version)' };

  this.obj.should.be.an.EntityDef();
  this.obj.should.have.property('creator').which.is.an.Actor();
});

should.Assertion.add('EntityDefFull', function assertEntityDefFull() {
  this.params = { operator: 'to be an Entity Def (version) including Conflict related fields' };

  this.obj.should.be.an.EntityDef();
  this.obj.should.have.property('data').which.is.nullOrObject();
  this.obj.should.have.property('dataReceived').which.is.nullOrObject();
  this.obj.should.have.property('source').which.is.nullOrObject();
  this.obj.should.have.property('baseDiff').which.is.nullOrArray();
  this.obj.should.have.property('serverDiff').which.is.nullOrArray();
  this.obj.should.have.property('conflict').which.is.nullOrString();
  this.obj.should.have.property('resolved').which.is.Boolean();
  this.obj.should.have.property('lastGoodVersion').which.is.Boolean();
  this.obj.should.have.property('relevantToConflict').which.is.Boolean();
});

should.Assertion.add('SourceType', function Source() {
  this.params = { operator: 'to be a Source Type' };

  this.obj.should.be.String();
  ['submission', 'api', 'fileUpload'].should.matchAny(this.obj);

});

// Entity Source
should.Assertion.add('EntitySource', function Source() {
  this.params = { operator: 'to be an Entity Source' };

  this.obj.should.have.property('type').which.is.a.SourceType();
  this.obj.should.have.property('details');

  // details are there only in case of type is submission
  if (this.obj.details != null) this.obj.details.should.be.EntitySourceSubmissionDetails();
});

// Entity Source Submission Details
should.Assertion.add('EntitySourceSubmissionDetails', function SubmissionDetails() {
  this.params = { operator: 'have Entity Source Submission details' };

  this.obj.should.have.property('xmlFormId').which.is.a.String();
  this.obj.should.have.property('instanceId').which.is.a.String();
  this.obj.should.have.property('instanceName'); // can be null
});

should.Assertion.add('skiptoken', function skiptoken(expected) {
  this.params = { operator: 'to have a skiptoken' };

  JSON.parse(Buffer.from(decodeURIComponent(new URL(this.obj).searchParams.get('$skiptoken').substr(2)), 'base64')).should.deepEqual(expected);
});
