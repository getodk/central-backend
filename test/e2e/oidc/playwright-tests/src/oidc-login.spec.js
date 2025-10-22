// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { test } = require('@playwright/test');

const { frontendUrl } = require('./config');
const { // eslint-disable-line object-curly-newline
  assertErrorRedirect,
  assertLocation,
  assertLoginSuccessful,
  fillLoginForm,
  initTest,
} = require('./utils'); // eslint-disable-line object-curly-newline

const password = 'topsecret123'; // fake-oidc-server will accept any non-empty password

test.describe.configure({ mode: 'parallel' });

test.describe('happy', () => {
  [
    [ 'no next param',       '',                   '/',            '/' ],          // eslint-disable-line no-multi-spaces
    [ 'internal next param', '?next=/some/path',   '/some/path',            '/some/path' ], // eslint-disable-line no-multi-spaces
    [ 'enketo next param',   '?next=/-/some/path', '/-/some/path', '/-/some/path' ], // eslint-disable-line no-multi-spaces
  ].forEach(([ description, initialQueryString, expectedBackendPath, expectedFrontendPath ]) => {
    test(`can log in (${description})`, async ({ browserName, page }, testInfo) => {
      // given
      await initTest({ browserName, page }, testInfo);

      // when
      await page.goto(`${frontendUrl}/v1/oidc/login${initialQueryString}`);
      await fillLoginForm(page, { username: 'alice', password });

      // then
      await assertLoginSuccessful(page, expectedBackendPath); // N.B. backend doesn't receive URL fragments
      await assertLocation(page, frontendUrl + expectedFrontendPath);
    });
  });
});

test.describe('redirected errors', () => {
  [
    [ 'user unknown by central',                'bob',     'deliberate-failure' ],       // eslint-disable-line no-multi-spaces
    [ `no 'email' claim provided`,              'dave',    'email-claim-not-provided' ], // eslint-disable-line no-multi-spaces
    [ `claim 'email_verified' has value false`, 'charlie', 'email-not-verified' ],       // eslint-disable-line no-multi-spaces
  ].forEach(([ description, username, expectedError ]) => {
    test(`successful authN, but ${description}`, async ({ browserName, page }, testInfo) => {
      // given
      await initTest({ browserName, page }, testInfo);

      // when
      await page.goto(`${frontendUrl}/v1/oidc/login`);
      await fillLoginForm(page, { username, password });

      // then
      await assertErrorRedirect(page, expectedError);
    });
  });
});

test('aborted login', async ({ browserName, page }, testInfo) => {
  // given
  await initTest({ browserName, page }, testInfo);

  // when
  await page.goto(`${frontendUrl}/v1/oidc/login`);
  await page.getByText('Cancel').click();

  // then
  // Upstream error message is not exposed to the client, but would be:
  // > access_denied (End-User aborted interaction)
  await assertErrorRedirect(page, 'internal-server-error');
});
