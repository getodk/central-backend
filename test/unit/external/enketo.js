const appRoot = require('app-root-path');
const nock = require('nock');
const querystring = require('querystring');
// eslint-disable-next-line import/no-dynamic-require
const enketo_ = require(appRoot + '/lib/external/enketo');
// eslint-disable-next-line import/no-dynamic-require
const Problem = require(appRoot + '/lib/util/problem');

describe('external/enketo', () => {
  const enketoConfig = {
    url: 'http://enketoHost:1234/enketoPath',
    apiKey: 'enketoApiKey'
  };
  const enketo = enketo_.init(enketoConfig);
  const enketoNock = nock('http://enketoHost:1234');
  const openRosaUrl = 'http://openRosaHost:5678/somePath';
  const xmlFormId = 'wellPumps';

  describe('preview', () => {
    it('should send a properly constructed request to Enketo', () => {
      enketoNock
        .post('/enketoPath/api/v2/survey')
        // eslint-disable-next-line space-before-function-paren, func-names
        .reply(201, function(uri, requestBody) {
          const base64Auth = Buffer.from('enketoApiKey:').toString('base64');
          const expectedQueryString = querystring.stringify({ server_url: openRosaUrl, form_id: xmlFormId });
          this.req.headers.authorization.should.equal(`Basic ${base64Auth}`);
          this.req.headers.cookie.should.equal('__Host-session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
          requestBody.should.equal(expectedQueryString);
          return JSON.stringify({ url: 'http://enke.to/::stuvwxyz', code: 201 });
        });
      return enketo.create(openRosaUrl, xmlFormId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    });

    it('should return the Enketo survey ID', () => {
      enketoNock
        .post('/enketoPath/api/v2/survey')
        .reply(201, { url: 'http://enke.to/::stuvwxyz', code: 201 });
      // eslint-disable-next-line no-trailing-spaces
      
      return enketo.create(openRosaUrl, xmlFormId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
        .then((result) => result.should.equal('::stuvwxyz'));
    });

    it('should return an Enketo single-survey ID', () => {
      enketoNock
        .post('/enketoPath/api/v2/survey/single/once')
        .reply(201, { single_once_url: 'http://enke.to/single/::stuvwxyz', code: 201 });
      // eslint-disable-next-line no-trailing-spaces
      
      return enketo.createOnceToken(openRosaUrl, xmlFormId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
        .then((result) => result.should.equal('::stuvwxyz'));
    });

    it('should throw a Problem if the Enketo response is not valid json', () => {
      enketoNock
        .post('/enketoPath/api/v2/survey')
        .reply(201, 'no json for you!');
      // eslint-disable-next-line no-trailing-spaces
      
      return enketo.create(openRosaUrl, xmlFormId, null)
        .should.be.rejectedWith(Problem.internal.enketoUnexpectedResponse('invalid JSON'));
    });

    it('should throw a Problem if the Enketo response url is unparseable', () => {
      enketoNock
        .post('/enketoPath/api/v2/survey')
        .reply(201, { url: 'http://enke.to/$$', code: 201 });
      // eslint-disable-next-line no-trailing-spaces
      
      return enketo.create(openRosaUrl, xmlFormId, null)
        .should.be.rejectedWith(Problem.internal.enketoUnexpectedResponse('Could not parse token from enketo response url: http://enke.to/$$'));
    });

    it('should throw a Problem if the Enketo response code is unexpected', () => {
      enketoNock
        .post('/enketoPath/api/v2/survey')
        .reply(204, {});
      // eslint-disable-next-line no-trailing-spaces
      
      return enketo.create(openRosaUrl, xmlFormId, null)
        .should.be.rejectedWith(Problem.internal.enketoUnexpectedResponse('wrong status code'));
    });
  });

  describe('edit', () => {
    it('should send a properly formatted request to enketo', () => {
      let run = false;
      enketoNock
        .post('/enketoPath/api/v2/instance')
        // eslint-disable-next-line space-before-function-paren, func-names
        .reply(201, function(uri, requestBody) {
          run = true;
          const base64Auth = Buffer.from('enketoApiKey:').toString('base64');
          const expectedQueryString = querystring.stringify({
            server_url: openRosaUrl,
            form_id: xmlFormId,
            instance: '<data/>',
            instance_id: 'instance',
            'instance_attachments[fileone.txt]': 'http://openRosaHost:5678/v1/projects/1/forms/wellPumps/submissions/logical/versions/instance/attachments/fileone.txt',
            return_url: 'http://openRosaHost:5678/#/projects/1/forms/wellPumps/submissions/logical'
          });
          this.req.headers.authorization.should.equal(`Basic ${base64Auth}`);
          this.req.headers.cookie.should.equal('__Host-session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
          requestBody.should.equal(expectedQueryString);
          return JSON.stringify({ edit_url: 'http://enke.to/::editedit', code: 201 });
        });

      return enketo.edit(
        openRosaUrl,
        'http://openRosaHost:5678',
        { projectId: 1, xmlFormId: 'wellPumps' },
        'logical',
        { xml: '<data/>', instanceId: 'instance' },
        [{ blobId: 1, name: 'fileone.txt' }, { blobId: null, name: 'filetwo.jpg' }],
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      ).then(() => { run.should.equal(true); });
    });

    it('should return an enketo edit url with the domain replaced', () => {
      enketoNock
        .post('/enketoPath/api/v2/instance')
        .reply(201, { edit_url: 'http://enke.to/::editedit', code: 201 });

      return enketo.edit(
        openRosaUrl,
        'http://openRosaHost:5678',
        { projectId: 1, xmlFormId: 'wellPumps' },
        'logical',
        { xml: '<data/>', instanceId: 'instance' },
        [],
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      ).then((url) => { url.should.equal('http://openrosahost:5678/::editedit'); });
    });

    it('should return an enketo edit url with the port and protocol replaced', () => {
      enketoNock
        .post('/enketoPath/api/v2/instance')
        .reply(201, { edit_url: 'http://enke.to/::editedit', code: 201 });

      return enketo.edit(
        openRosaUrl,
        'https://securehost',
        { projectId: 1, xmlFormId: 'wellPumps' },
        'logical',
        { xml: '<data/>', instanceId: 'instance' },
        [],
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      ).then((url) => { url.should.equal('https://securehost/::editedit'); });
    });

    it('should return a custom message if Enketo says it is too soon', () => {
      enketoNock
        .post('/enketoPath/api/v2/instance')
        .reply(405, { code: 405, message: 'Not allowed. Record is already being edited' });

      return enketo.edit(
        openRosaUrl,
        'http://openRosaHost:5678',
        { projectId: 1, xmlFormId: 'wellPumps' },
        'logical',
        { xml: '<data/>', instanceId: 'instance' },
        [],
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      ).should.be.rejected().then((err) => {
        err.problemCode.should.equal(409.13);
        /wait one minute/.test(err.message).should.equal(true);
      });
    });
  });
});

