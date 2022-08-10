const appRoot = require('app-root-path');
// eslint-disable-next-line import/no-dynamic-require
const Problem = require(appRoot + '/lib/util/problem');

// we aren't going to test the many problem types here, only the basic infrastructure.
describe('Problem', () => {
  it('should flag as a Problem', () => {
    (new Problem()).isProblem.should.equal(true);
  });

  it('should truncate the detailed code to give the http code', () => {
    (new Problem(404.42)).httpCode.should.equal(404);
  });
});

