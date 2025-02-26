const appRoot = require('app-root-path');
// eslint-disable-next-line import/no-dynamic-require
const { safeNextPathFrom } = require(appRoot + '/lib/util/html');

describe('util/html', () => {
  describe('safeNextPathFrom()', () => {
    [
      // odk-central-frontend
      [ '/account/edit',          '/account/edit' ],            // eslint-disable-line no-multi-spaces
      [ '/users',                 '/users' ],                   // eslint-disable-line no-multi-spaces
      [ '/users"><badTag ',       '/users%22%3E%3CbadTag' ],    // eslint-disable-line no-multi-spaces

      // query params
      [ '/users?"><badTag ',      '/users?%22%3E%3CbadTag' ],   // eslint-disable-line no-multi-spaces
      [ '/users?="><badTag ',     '/users?=%22%3E%3CbadTag' ],  // eslint-disable-line no-multi-spaces
      [ '/users?a="><badTag ',    '/users?a=%22%3E%3CbadTag' ], // eslint-disable-line no-multi-spaces
      [ '/users?"=><badTag ',     '/users?%22=%3E%3CbadTag' ],  // eslint-disable-line no-multi-spaces

      // fragments
      [ '/users#"><badTag ',      '/users#%22%3E%3CbadTag' ],   // eslint-disable-line no-multi-spaces
      [ '/users#="><badTag ',     '/users#=%22%3E%3CbadTag' ],  // eslint-disable-line no-multi-spaces
      [ '/users#a="><badTag ',    '/users#a=%22%3E%3CbadTag' ], // eslint-disable-line no-multi-spaces
      [ '/users#"=><badTag ',     '/users#%22=%3E%3CbadTag' ],  // eslint-disable-line no-multi-spaces

      // query string & fragment
      [ '/users?"=1#"=><badTag ', '/users?%22=1#%22=%3E%3CbadTag' ], // eslint-disable-line no-multi-spaces

      // enketo-express
      [ '/-/xyz',                 'http://localhost:8989/-/xyz' ],                       // eslint-disable-line no-multi-spaces
      [ '/-/xyz?"><b',            'http://localhost:8989/-/xyz?%22%3E%3Cb' ],            // eslint-disable-line no-multi-spaces
      [ '/-/xyz#"><b',            'http://localhost:8989/-/xyz#%22%3E%3Cb' ],            // eslint-disable-line no-multi-spaces
      [ '/-/xyz?"><b#"><b',       'http://localhost:8989/-/xyz?%22%3E%3Cb#%22%3E%3Cb' ], // eslint-disable-line no-multi-spaces
      // with path traversal
      [ '/-/../version.txt',      '/version.txt' ],                                    // eslint-disable-line no-multi-spaces

      // bad domain
      [ 'http://example.com',                  '/' ], // eslint-disable-line no-multi-spaces
      // with @ char - not a problem if positioned in fragment or after first `/`:
      [ '@baddomain.com',                      '/@baddomain.com' ],                         // eslint-disable-line no-multi-spaces
      [ '/-/@baddomain.com',                   'http://localhost:8989/-/@baddomain.com' ],    // eslint-disable-line no-multi-spaces
      [ 'http://localhost:8989@baddomain.com', '/' ],                                       // eslint-disable-line no-multi-spaces
      [ 'http://localhost:8989@baddomain.com', '/' ],                                       // eslint-disable-line no-multi-spaces

      // bad protocols
      [ 'https://localhost:8989', '/' ], // eslint-disable-line no-multi-spaces
      [ 'javascript:badFn()',     '/' ], // eslint-disable-line no-multi-spaces,no-script-url
    ].forEach(([next, expected]) => {
      it(`should convert next=${next} to ${expected}`, () => {
        safeNextPathFrom(next).should.equal(expected);
      });
    });
  });
});
