const appRoot = require('app-root-path');
// eslint-disable-next-line import/no-dynamic-require
const { html, safeNextPathFrom } = require(appRoot + '/lib/util/html');

describe('util/html', () => {
  describe('html()', () => {
    it('should return a simple string unmodified', () => {
      // when
      const output = html`a string without references to vars`;

      // then
      output.should.equal('a string without references to vars');
    });

    it('should return input with vars substituted', () => {
      // given
      const x = 1;
      const y = 'helo';

      // when
      const output = html`<div>${x}</div><span>${y}${x}</span>`;

      // then
      output.should.equal('<div>1</div><span>helo1</span>');
    });
  });

  describe('safeNextPathFrom()', () => {
    [
      [ '/-/xyz',                    'http://localhost:8989/-/xyz' ], // eslint-disable-line no-multi-spaces
      [ '/account/edit',             '/#/account/edit' ],             // eslint-disable-line no-multi-spaces
      [ '/users',                    '/#/users' ],                    // eslint-disable-line no-multi-spaces
      [ '/users"><badTag ',          '/#/users%22%3E%3CbadTag' ],     // eslint-disable-line no-multi-spaces
      [ 'http://example.com',        '/#/' ],                         // eslint-disable-line no-multi-spaces
      [ 'https://example.com',       '/#/' ],                         // eslint-disable-line no-multi-spaces
      [ 'javascript:badFn()',        '/#/' ],                         // eslint-disable-line no-multi-spaces
    ].forEach(([next, expected]) => {
      it(`should convert next=${next} to ${expected}`, () => {
        safeNextPathFrom(next).should.equal(expected);
      });
    });
  });
});
