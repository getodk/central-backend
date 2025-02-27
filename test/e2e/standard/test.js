// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const assert = require('node:assert');
const fs = require('node:fs');

const SUITE_NAME = 'test/e2e/standard';
const { apiClient } = require('../util/api');

const serverUrl = 'http://localhost:8383';
const userEmail = 'x@example.com';
const userPassword = 'secret1234';

describe('Cache headers', () => {
  const undici = require('undici');

  const privateCacheDispatcher = new undici.Agent().compose(undici.interceptors.cache({
    cacheByDefault: undefined, // do not cache responses without explicit expiration
    methods: [ 'GET' ],
    type: 'private',
  }));
  const sharedCacheDispatcher = new undici.Agent().compose(undici.interceptors.cache({
    cacheByDefault: Number.MAX_SAFE_INTEGER, // aggressively cache everything
    methods: [ 'GET' ],
    type: 'shared',
  }));

  let api;
  let projectId = ':projectId';
  let xmlFormId = ':xmlFormId';
  let xmlFormVersion = ':xmlFormVersion';

  const withSessionHeader = (opts={}) => ({
    ...opts,
    headers: { ...opts.headers, Authorization:`Bearer ${api.getSessionToken()}` },
  });
  const withPrivateCache = (opts={}) => ({ ...opts, dispatcher: privateCacheDispatcher });
  const withSharedCache  = (opts={}) => ({ ...opts, dispatcher:  sharedCacheDispatcher });

  before(async () => {
    // given
    api = await apiClient(SUITE_NAME, { serverUrl, userEmail, userPassword });
    projectId = await createProject(api);
    // and
    const form = await uploadForm(api, projectId, 'test-form.xml');
    xmlFormId = form.xmlFormId;
    xmlFormVersion = form.version;
    // and
    await uploadSubmission(api, projectId, xmlFormId, xmlFormVersion, 'cache-test-submission');
  });

  describe('private paths', () => {
    [
      () => `${serverUrl}/v1/projects/${projectId}`,
      () => `${serverUrl}/v1/projects/${projectId}/forms/${encodeURIComponent(xmlFormId)}`,
      () => `${serverUrl}/v1/projects/${projectId}/forms/${encodeURIComponent(xmlFormId)}.svc/Submissions('cache-test-submission')`,
    ].forEach(url => {
      it(`should cache ${url()} in a private cache for a short amount of time`, async () => {
        // given
        const res1 = await undici.fetch(url(), withPrivateCache(withSessionHeader()));
        assert.equal(res1.ok, true);

        // when
        const res2 = await undici.fetch(url(), withPrivateCache());

        // then
        assert.equal(res2.ok, true);

        // when
        await sleep(1000);
        const res3 = await undici.fetch(url(), withPrivateCache(withSessionHeader()));

        // then
        assert.equal(res3.ok, true);
        assert.equal(res3.headers.get('date'), res1.headers.get('date'));

        // and
        assert.equal(res1.headers.get('Cache-Control'), 'private, max-age=0');
        assert.equal(res2.headers.get('Cache-Control'), 'private, max-age=0');
        assert.equal(res3.headers.get('Cache-Control'), 'private, max-age=0');
        assert.equal(res1.headers.get('Expires'), undefined);
        assert.equal(res2.headers.get('Expires'), undefined);
        assert.equal(res3.headers.get('Expires'), undefined);
      });

      it(`should NOT cache ${url()} in a shared cache`, async () => {
        // given
        const res1 = await undici.fetch(url(), withSharedCache(withSessionHeader()));
        assert.equal(res1.ok, true);

        // when
        const res2 = await undici.fetch(url(), withSharedCache());

        // then
        assert.equal(res2.ok, false);

        // when
        await sleep(1000);
        const res3 = await undici.fetch(url(), withSharedCache(withSessionHeader()));

        // then
        assert.equal(res3.ok, true);
        assert.notEqual(res3.headers.get('date'), res1.headers.get('date'));

        // and
        assert.equal(res1.headers.get('Cache-Control'), 'private, max-age=0');
        assert.equal(res2.headers.get('Cache-Control'), 'private, max-age=0');
        assert.equal(res3.headers.get('Cache-Control'), 'private, max-age=0');
        assert.equal(res1.headers.get('Expires'), undefined);
        assert.equal(res2.headers.get('Expires'), undefined);
        assert.equal(res3.headers.get('Expires'), undefined);
      });
    });
  });

  describe('single-use paths', () => {
    [
      () => `${serverUrl}/v1/sessions/restore`,
    ].forEach(url => {
      it(`should NOT cache ${url()} in a private cache`, async () => {
        // given
        const res1 = await undici.fetch(url(), withPrivateCache(withSessionHeader()));
        assert.equal(res1.ok, true);

        // when
        const res2 = await undici.fetch(url(), withPrivateCache());

        // then
        assert.equal(res2.ok, false);

        // when
        await sleep(1000);
        const res3 = await undici.fetch(url(), withPrivateCache(withSessionHeader()));

        // then
        assert.equal(res3.ok, true);
        assert.notEqual(res3.headers.get('date'), res1.headers.get('date'));

        // and
        assert.equal(res1.headers.get('Cache-Control'), 'no-store');
        assert.equal(res2.headers.get('Cache-Control'), 'no-store');
        assert.equal(res3.headers.get('Cache-Control'), 'no-store');
        assert.equal(res1.headers.get('Expires'), undefined);
        assert.equal(res2.headers.get('Expires'), undefined);
        assert.equal(res3.headers.get('Expires'), undefined);
      });

      it(`should NOT cache ${url()} in a shared cache`, async () => {
        // given
        const res1 = await undici.fetch(url(), withSharedCache(withSessionHeader()));
        assert.equal(res1.ok, true);

        // when
        const res2 = await undici.fetch(url(), withSharedCache());

        // then
        assert.equal(res2.ok, false);

        // when
        await sleep(1000);
        const res3 = await undici.fetch(url(), withSharedCache(withSessionHeader()));

        // then
        assert.equal(res3.ok, true);
        assert.notEqual(res3.headers.get('date'), res1.headers.get('date'));

        // and
        assert.equal(res1.headers.get('Cache-Control'), 'no-store');
        assert.equal(res2.headers.get('Cache-Control'), 'no-store');
        assert.equal(res3.headers.get('Cache-Control'), 'no-store');
        assert.equal(res1.headers.get('Expires'), undefined);
        assert.equal(res2.headers.get('Expires'), undefined);
        assert.equal(res3.headers.get('Expires'), undefined);
      });
    });
  });
});

describe('#1157 - Backend crash when opening hostile-named submission detail', () => {
  let api, projectId, xmlFormId, xmlFormVersion; // eslint-disable-line one-var, one-var-declaration-per-line

  it('should handle weird submission instanceId gracefully', async () => {
    // given
    api = await apiClient(SUITE_NAME, { serverUrl, userEmail, userPassword });
    projectId = await createProject(api);
    // and
    const form = await uploadForm(api, projectId, 'test-form.xml');
    xmlFormId = form.xmlFormId;
    xmlFormVersion = form.version;
    // and
    const goodSubmissionId = 'good-id';
    await uploadSubmission(api, projectId, xmlFormId, xmlFormVersion, goodSubmissionId);

    // expect 200:
    await api.apiGet(`projects/${projectId}/forms/${encodeURIComponent(xmlFormId)}.svc/Submissions('${goodSubmissionId}')`);

    // given
    const badSubmissionId = 'bad-id:';
    await uploadSubmission(api, projectId, xmlFormId, xmlFormVersion, badSubmissionId);
    // when
    await assert.rejects(
      () => api.apiGet(`projects/${projectId}/forms/${encodeURIComponent(xmlFormId)}.svc/Submissions('${badSubmissionId}')?%24select=__id%2C__system%2Cmeta`),
      (err) => {
        // then
        assert.strictEqual(err.responseStatus, 404);
        assert.deepStrictEqual(JSON.parse(err.responseText), {
          message: 'Could not find the resource you were looking for.',
          code: 404.1,
        });
        return true;
      },
    );

    // and service has not crashed:
    const rootRes = await fetch(serverUrl);
    assert.strictEqual(rootRes.status, 404);
    assert.strictEqual(await rootRes.text(), '{"message":"Expected an API version (eg /v1) at the start of the request URL.","code":404.2}');
  });
});

async function createProject(api) {
  const project = await api.apiPostJson(
    'projects',
    { name:`standard-test-${new Date().toISOString().replace(/\..*/, '')}` },
  );
  return project.id;
}

function uploadForm(api, projectId, xmlFilePath) {
  return api.apiPostFile(`projects/${projectId}/forms?publish=true`, xmlFilePath);
}

function uploadSubmission(api, projectId, xmlFormId, xmlFormVersion, submissionId) {
  const xmlTemplate = fs.readFileSync('submission.xml', { encoding: 'utf8' });
  const formXml = xmlTemplate
    .replace('{{submissionId}}', submissionId)
    .replace('{{formId}}', xmlFormId)
    .replace('{{formVersion}}', xmlFormVersion);

  return api.apiPostFile(`projects/${projectId}/forms/${encodeURIComponent(xmlFormId)}/submissions?deviceID=testid`, {
    body: formXml,
    mimeType: 'application/xml',
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms)); // eslint-disable-line no-promise-executor-return
}
