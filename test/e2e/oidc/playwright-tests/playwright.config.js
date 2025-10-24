// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { devices } = require('@playwright/test');

const availableProjects = {
  'chrome-desktop': { channel: 'chrome' },
  'chrome-mobile':  { ...devices['Pixel 5'] },         // eslint-disable-line key-spacing,no-multi-spaces
  'chromium':       { ...devices['Desktop Chrome'] },  // eslint-disable-line key-spacing,no-multi-spaces,quote-props
  'edge':           { channel: 'msedge' },             // eslint-disable-line key-spacing,no-multi-spaces,quote-props
  'firefox':        { ...devices['Desktop Firefox'] }, // eslint-disable-line key-spacing,no-multi-spaces,quote-props
  'safari-mobile':  { ...devices['iPhone 12'] },       // eslint-disable-line key-spacing,no-multi-spaces
  'webkit':         { ...devices['Desktop Safari'] },  // eslint-disable-line key-spacing,no-multi-spaces,quote-props
};
const requestedBrowsers = process.env.ODK_PLAYWRIGHT_BROWSERS || 'firefox';
const projects = requestedBrowsers
  .split(',')
  .map(name => {
    if (!Object.prototype.hasOwnProperty.call(availableProjects, name)) {
      throw new Error(`No project config available with name '${name}'!`);
    }
    const use = availableProjects[name];
    return { name, use };
  });

/**
 * @see https://playwright.dev/docs/test-configuration
 * @type {import('@playwright/test').PlaywrightTestConfig}
 */
const config = {
  testDir: 'src',
  /* Maximum time one test can run for. */
  timeout: 10 * 1000,
  expect: { timeout: 2000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // retries mean failure
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [ [ 'html', { outputFolder: 'results/html-report' } ] ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    actionTimeout: 0,
    baseURL: 'https://odk-central.example.org:8989',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // desperate debug options - fiddle with these when you're confused what's going on:
    video: 'retain-on-failure',
    headless: true,
  },
  projects,
  outputDir: 'results/basic',
  globalSetup: require.resolve('./src/global-setup-teardown'),
};

module.exports = config;
