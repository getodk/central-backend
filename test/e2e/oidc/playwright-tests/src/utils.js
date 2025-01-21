// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/* eslint-disable no-console,no-use-before-define */

module.exports = {
  assertErrorRedirect,
  assertLocation,
  assertLoginSuccessful,
  assertTitle,
  fillLoginForm,
  initTest,
};

const assert = require('node:assert');
const { expect } = require('@playwright/test');

const { frontendUrl } = require('./config');

const SESSION_COOKIE = (frontendUrl.startsWith('https://') ? '__Host-' : '') + 'session';

async function assertErrorRedirect(page, expectedErrorCode) {
  await page.waitForFunction(expected => {
    const { href, hash } = window.location;
    const fakeSearch = hash.replace(/[^?]*\?/, ''); // hash & search exchanged in odk-central-frontend
    const actual = new URLSearchParams(fakeSearch).get('oidcError');

    console.log(`
      assertErrorRedirect()
        window.location.href: ${href}
        window.location.hash: ${hash}
         expected error code: ${expected}
           actual error code: ${actual}
    `);
    return actual === expected;
  }, expectedErrorCode);
}

function assertLocation(page, expectedLocation) {
  console.log('     assertLocation()');
  console.log(`      expected: '${expectedLocation}'`);
  return page.waitForFunction(expected => {
    const actualLocation = window.location.href;
    console.log(`actual: '${actualLocation}'`);
    return actualLocation === expected;
  }, expectedLocation);
}

async function assertLoginSuccessful(page, expectedPath) {
  await expect(page.locator('h1')).toHaveText(`${expectedPath} success!`);

  const requestCookies = JSON.parse(await page.locator('#request-cookies').textContent());

  console.log('requestCookies:', JSON.stringify(requestCookies, null, 2));

  assert(requestCookies[SESSION_COOKIE], 'No session cookie found!');
  assert(requestCookies['__csrf'],       'No CSRF cookie found!'); // eslint-disable-line dot-notation,no-multi-spaces
  assert.equal(Object.keys(requestCookies).length, 2, 'Unexpected requestCookie count!');
}

function assertTitle(page, expectedTitle) {
  return expect(page.locator('h1')).toHaveText(expectedTitle);
}

async function fillLoginForm(page, { username, password }) {
  // Wait for autofocus.  On webkit, it looks like `autofocus` on the username
  // (`login`) field can sometimes steal focus after the `password` field
  // locator has been successfully executed.
  await sleep(1);

  await page.locator('input[name=login]').fill('playwright-' + username);
  await page.locator('input[name=password]').fill(password);
  await page.locator('button[type=submit]').click();
  await page.getByRole('button', { name: 'Continue' }).click();
}

function initTest({ browserName, page }, testInfo) {
  page.on('console', msg => {
    const level = msg.type().toUpperCase();
    console.log(level, `[${browserName}:${testInfo.title}]`, msg.text());
  });
}

async function sleep(seconds) {
  return new Promise(resolve => {
    setTimeout(resolve, seconds * 1000);
  });
}
