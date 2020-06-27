const appRoot = require('app-root-path');
const nock = require('nock');
const querystring = require('querystring');
const should = require('should');
const enketo_ = require(appRoot + '/lib/util/enketo');
const Problem = require(appRoot + '/lib/util/problem');

describe('util/enketo', () => {
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
        .reply(201, function(uri, requestBody) {
          const base64Auth = Buffer.from('enketoApiKey:').toString('base64');
          const expectedQueryString = querystring.stringify({ server_url: openRosaUrl, form_id: xmlFormId });
          this.req.headers.authorization.should.equal(`Basic ${base64Auth}`);
          this.req.headers.cookie.should.equal('__Host-session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
          requestBody.should.equal(expectedQueryString);
          return JSON.stringify({ url: 'http://enke.to/::stuvwxyz', code: 201 });
        });
      const response = {};
      return enketo.create(openRosaUrl, xmlFormId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', response);
    });

    it('should return the Enketo survey ID', () => {
      enketoNock
        .post('/enketoPath/api/v2/survey')
        .reply(201, { url: 'http://enke.to/::stuvwxyz', code: 201 });
      const response = {};
      return enketo.create(openRosaUrl, xmlFormId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', response)
        .then((result) => result.should.equal('::stuvwxyz'));
    });

    it('should throw a Problem if the Enketo response is not valid json', () => {
      enketoNock
        .post('/enketoPath/api/v2/survey')
        .reply(201, 'no json for you!');
      const response = {};
      return enketo.create(openRosaUrl, xmlFormId, null, response)
        .should.be.rejectedWith(Problem.internal.enketoUnexpectedResponse('invalid JSON'));
    });

    it('should throw a Problem if the Enketo response url is unparseable', () => {
      enketoNock
        .post('/enketoPath/api/v2/survey')
        .reply(201, { url: 'http://enke.to/$$', code: 201 });
      const response = {};
      return enketo.create(openRosaUrl, xmlFormId, null, response)
        .should.be.rejectedWith(Problem.internal.enketoUnexpectedResponse('Could not parse token from enketo response url: http://enke.to/$$'));
    });

    it('should throw a Problem if the Enketo response code is unexpected', () => {
      enketoNock
        .post('/enketoPath/api/v2/survey')
        .reply(204, {});
      const response = {};
      return enketo.create(openRosaUrl, xmlFormId, null, response)
        .should.be.rejectedWith(Problem.internal.enketoUnexpectedResponse('wrong status code'));
    });
  });
});

