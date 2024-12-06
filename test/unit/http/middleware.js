const should = require('should');
const { createRequest } = require('../../util/node-mocks-http');

const appRoot = require('app-root-path');
const middleware = require(appRoot + '/lib/http/middleware');
const Option = require(appRoot + '/lib/util/option');

describe('middleware', () => {
  describe('versionParser', () => {
    const { versionParser } = middleware;
    it('should fallthrough to the error handler if no version is present', (done) => {
      const url = '/hello/test/v1';
      const request = createRequest({ url, originalUrl: url });
      versionParser(request, null, (error) => {
        error.isProblem.should.equal(true);
        error.problemCode.should.equal(404.2);
        done();
      });
    });

    it('should fallthrough to the error handler if the version is wrong', (done) => {
      const url = '/v4/users';
      const request = createRequest({ url, originalUrl: url });
      versionParser(request, null, (error) => {
        error.isProblem.should.equal(true);
        error.problemCode.should.equal(404.3);
        error.problemDetails.got.should.equal('4');
        done();
      });
    });

    it('should strip off the version before calling next', (done) => {
      const url = '/v1/users/23';
      const request = createRequest({ url, originalUrl: url });
      versionParser(request, null, () => {
        request.originalUrl.should.equal('/v1/users/23');
        request.url.should.equal('/users/23');
        done();
      });
    });

    it('should supply a numeric representation of the received number under request', (done) => {
      const url = '/v1/forms/testform/submissions';
      const request = createRequest({ url, originalUrl: url });
      versionParser(request, null, () => {
        request.apiVersion.should.equal(1);
        done();
      });
    });
  });

  describe('fieldKeyParser', () => {
    const { fieldKeyParser } = middleware;
    it('should always set request.fieldKey None if nothing is given', (done) => {
      const originalUrl = '/v1/users/23';
      const request = createRequest({ originalUrl, url: originalUrl.substr(3) });
      fieldKeyParser(request, null, () => {
        request.fieldKey.should.equal(Option.none());
        done();
      });
    });

    it('should pass through any field key content', (done) => {
      const originalUrl = '/v1/key/12|45/users/23';
      const request = createRequest({ originalUrl, url: originalUrl.substr(3) });
      fieldKeyParser(request, null, () => {
        request.fieldKey.should.eql(Option.of('12|45'));
        request.originalUrl.should.equal('/v1/key/12|45/users/23');
        request.url.should.equal('/users/23');
        done();
      });
    });

    it('should set Some(fk) and rewrite URL if a prefix key is found', (done) => {
      const originalUrl = '/v1/key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/users/23';
      const request = createRequest({ originalUrl, url: originalUrl.substr(3) });
      fieldKeyParser(request, null, () => {
        request.fieldKey.should.eql(Option.of('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
        request.originalUrl.should.equal('/v1/key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/users/23');
        request.url.should.equal('/users/23');
        done();
      });
    });

    it('should decode percent-encoded prefix keys', (done) => {
      const originalUrl = '/v1/key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%24aa!aaaaaaaaaaaaaaaaaa/users/23';
      const request = createRequest({ originalUrl, url: originalUrl.substr(3) });
      fieldKeyParser(request, null, () => {
        request.fieldKey.should.eql(Option.of('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$aa!aaaaaaaaaaaaaaaaaa'));
        request.originalUrl.should.equal('/v1/key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%24aa!aaaaaaaaaaaaaaaaaa/users/23');
        request.url.should.equal('/users/23');
        done();
      });
    });

    it('should pass through any query key content', (done) => {
      const originalUrl = '/v1/users/23?st=inva|id';
      const request = createRequest({ originalUrl, url: originalUrl.substr(3) });
      request.query.st.should.equal('inva|id');

      fieldKeyParser(request, null, () => {
        request.fieldKey.should.eql(Option.of('inva|id'));
        request.originalUrl.should.equal('/v1/key/inva|id/users/23?st=inva|id');
        request.url.should.equal('/users/23?st=inva|id');
        should(request.query.st).be.undefined();
        done();
      });
    });

    it('should escape slashes in the rewritten path prefix', (done) => {
      const originalUrl = '/v1/users/23?st=in$va/i/d';
      const request = createRequest({ originalUrl, url: originalUrl.substr(3) });
      request.query.st.should.equal('in$va/i/d');

      fieldKeyParser(request, null, () => {
        request.fieldKey.should.eql(Option.of('in$va/i/d'));
        request.originalUrl.should.equal('/v1/key/in$va%2Fi%2Fd/users/23?st=in$va/i/d');
        request.url.should.equal('/users/23?st=in$va/i/d');
        should(request.query.st).be.undefined();
        done();
      });
    });

    it('should set Some(fk) and rewrite URL if a query key is found', (done) => {
      const originalUrl = '/v1/users/23?st=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const request = createRequest({ originalUrl, url: originalUrl.substr(3) });
      request.query.st.should.equal('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

      fieldKeyParser(request, null, () => {
        request.fieldKey.should.eql(Option.of('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
        request.originalUrl.should.equal('/v1/key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/users/23?st=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
        request.url.should.equal('/users/23?st=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
        should(request.query.st).be.undefined();
        done();
      });
    });

    it('should decode percent-encoded query keys', (done) => {
      const originalUrl = '/v1/users/23?st=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%24aa!aaaaaaaaaaaaaaaaaa';
      const request = createRequest({ originalUrl, url: originalUrl.substr(3) });
      request.query.st.should.equal('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$aa!aaaaaaaaaaaaaaaaaa');

      fieldKeyParser(request, null, () => {
        request.fieldKey.should.eql(Option.of('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$aa!aaaaaaaaaaaaaaaaaa'));
        should(request.query.st).be.undefined();
        done();
      });
    });
  });
});

