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

  let api;
  let projectId = ':projectId';
  let xmlFormId = ':xmlFormId';
  let xmlFormVersion = ':xmlFormVersion';

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
      describe(url(), () => {
        testTable(`
          inputs                                              || expected outputs (2nd response)
          with cache | has session | manual etag | after max-age || response status | date
          -----------|-------------|-------------|---------------||-----------------|---------------
                  ❌ |          ❌ |          ❌ |            ❌ || 403             | N/A
                  ❌ |          ❌ |          ❌ |            ✅ || 403             | N/A
                  ❌ |          ❌ |          ✅ |            ❌ || 403             | N/A
                  ❌ |          ❌ |          ✅ |            ✅ || 403             | N/A
                  ❌ |          ✅ |          ❌ |            ❌ || 200             | race-condition
                  ❌ |          ✅ |          ❌ |            ✅ || 200             | changed
                  ❌ |          ✅ |          ✅ |            ❌ || 304             | race-condition
                  ❌ |          ✅ |          ✅ |            ✅ || 304             | changed
              shared |          ❌ |          ❌ |            ❌ || 403             | N/A
              shared |          ❌ |          ❌ |            ✅ || 403             | N/A
              shared |          ❌ |          ✅ |            ❌ || 403             | N/A
              shared |          ❌ |          ✅ |            ✅ || 403             | N/A
              shared |          ✅ |          ❌ |            ❌ || 200             | race-condition
              shared |          ✅ |          ❌ |            ✅ || 200             | changed
              shared |          ✅ |          ✅ |            ❌ || 304             | race-condition
              shared |          ✅ |          ✅ |            ✅ || 304             | changed
             private |          ❌ |          ❌ |            ❌ || 403             | N/A
             private |          ❌ |          ❌ |            ✅ || 403             | N/A
             private |          ❌ |          ✅ |            ❌ || 403             | N/A
             private |          ❌ |          ✅ |            ✅ || 403             | N/A
             private |          ✅ |          ❌ |            ❌ || 200             | same
             private |          ✅ |          ❌ |            ✅ || 200             | same
             private |          ✅ |          ✅ |            ❌ || 200             | same
             private |          ✅ |          ✅ |            ✅ || 200             | same
        `)
          .forEach(args => testSecondRequest(url, args,
            [ 'Cache-Control', 'private, no-cache' ],
            [ 'Expires',        undefined ],
            [ 'Vary',          'Accept-Encoding, Authorization, Cookie' ],
          ));
      });
    });
  });

  describe('single-use paths', () => {
    [
      () => `${serverUrl}/v1/sessions/restore`,
    ].forEach(url => {
      describe(url(), () => {
        testTable(`
          inputs                                              || expected outputs
          with cache | has session | manual etag | after max-age || response status | date
          -----------|-------------|-------------|---------------||-----------------|---------------
                  ❌ |          ❌ |          ❌ |            ❌ || 404             | N/A
                  ❌ |          ❌ |          ❌ |            ✅ || 404             | N/A
                  ❌ |          ❌ |          ✅ |            ❌ || 404             | N/A
                  ❌ |          ❌ |          ✅ |            ✅ || 404             | N/A
                  ❌ |          ✅ |          ❌ |            ❌ || 200             | race-condition
                  ❌ |          ✅ |          ❌ |            ✅ || 200             | changed
                  ❌ |          ✅ |          ✅ |            ❌ || 304             | race-condition
                  ❌ |          ✅ |          ✅ |            ✅ || 304             | changed
              shared |          ❌ |          ❌ |            ❌ || 404             | N/A
              shared |          ❌ |          ❌ |            ✅ || 404             | N/A
              shared |          ❌ |          ✅ |            ❌ || 404             | N/A
              shared |          ❌ |          ✅ |            ✅ || 404             | N/A
              shared |          ✅ |          ❌ |            ❌ || 200             | race-condition
              shared |          ✅ |          ❌ |            ✅ || 200             | changed
              shared |          ✅ |          ✅ |            ❌ || 304             | race-condition
              shared |          ✅ |          ✅ |            ✅ || 304             | changed
             private |          ❌ |          ❌ |            ❌ || 404             | N/A
             private |          ❌ |          ❌ |            ✅ || 404             | N/A
             private |          ❌ |          ✅ |            ❌ || 404             | N/A
             private |          ❌ |          ✅ |            ✅ || 404             | N/A
             private |          ✅ |          ❌ |            ❌ || 200             | race-condition
             private |          ✅ |          ❌ |            ✅ || 200             | changed
             private |          ✅ |          ✅ |            ❌ || 304             | race-condition
             private |          ✅ |          ✅ |            ✅ || 304             | changed
        `)
          .forEach(args => testSecondRequest(url, args,
            [ 'Cache-Control', 'no-store' ],
            [ 'Expires',        undefined ],
            [ 'Vary',           undefined ],
          ));
      });
    });
  });

  function testTable(tableString) {
    const lines = tableString.split('\n');
    const idxHeaderEnd = lines.findIndex(line => line.match(/^\s*-+(\|+-+)+\s*$/));
    return lines
      .map(line => line.replace(/\/\/.*/, '')) // remove comments starting with //
      .filter((line, idx) => line.trim() && idx > idxHeaderEnd)
      .map(line => line
        .trim()
        .split(/\s*\|+\s*/)
        .map(str => {
          if (str === '✅') return true;
          if (str === '❌') return false;
          return str;
        }));
  }

  function testSecondRequest(url, [ cache, useSession, useEtag, useSleep, expectedStatus, dateExpectation ], ...expectedHeaders) {
    if(!useSession) {
      scenario('without session',     withBearerToken, withoutAuth);
    } else {
      scenario('with bearer token',   withBearerToken, withBearerToken);

      scenario('with session cookie', withCookie,      withCookie);
    }

    function withoutAuth(opts) {
      return opts;
    }

    function withBearerToken(opts={}) {
      return {
        ...opts,
        headers: { ...opts.headers, authorization:`Bearer ${api.getSessionToken()}` },
      };
    }

    function withCookie(opts={}) {
      return {
        ...opts,
        headers: {
          ...opts.headers,
          cookie: `session=${api.getSessionToken()}`,
          'x-forwarded-proto': 'https', // see lib/http/preprocessors.js
        },
      };
    }

    function scenario(authType, withFirstAuth, withSecondAuth) {
      return it(`should return ${expectedStatus} ${authType} and ${JSON.stringify({ cache, useSession, useEtag, useSleep })}`, async function() {
        this.timeout(2000);

        // Testing with cacheByDefault: MAX_SAFE_INTEGER is appropriate for
        // testing privacy & integrity of cached data.  There may be a more
        // appropriate value if looking to test real-world browser behaviour.
        const dispatcher = (() => {
          switch (cache) {
            case 'private': return new undici.Agent().compose(undici.interceptors.cache({
              cacheByDefault: Number.MAX_SAFE_INTEGER, // aggressively cache everything
              methods: [ 'GET' ],
              type: 'private',
            }));
            case 'shared': return new undici.Agent().compose(undici.interceptors.cache({
              cacheByDefault: Number.MAX_SAFE_INTEGER, // aggressively cache everything
              methods: [ 'GET' ],
              type: 'shared',
            }));
            case false: return;
            default: throw new Error(`Unrecognised cache option '${cache}'`);
          }
        })();

        // Note that undici has had various historical issues with case-sensitivity
        // of header names.  With this in mind, it's generally safest to follow the
        // undici style of using lower-case header names.
        const baseOpts = {
          dispatcher,
          // Base caching headers are set to work around "helpful" fetch behaviour.
          // These overrides may make these tests behave less like browsers, which
          // may be of significance if trying to tune real-world client behaviour
          // for e.g. odk-central-frontend users.
          // See: https://github.com/nodejs/undici/issues/1930
          headers: {
            'cache-control': 'max-stale=3600',
            'pragma':        '', // eslint-disable-line quote-props
          },
        };

        const withEtagFrom = (res, opts={}) => ({ ...opts, headers: { ...opts.headers, 'if-none-match': res.headers.get('ETag') } });

        // given
        const opts1 = withFirstAuth(baseOpts);
        const res1 = await undici.fetch(url(), opts1);
        assert.equal(res1.ok, true, `Expected OK response status, but got ${res1.status}`);
        // and
        let opts2 = baseOpts;
        if (useEtag)    opts2 = withEtagFrom(res1, opts2);
        if (useSession) opts2 = withSecondAuth(opts2);

        // when
        if (useSleep) await sleep(1000);
        const res2 = await undici.fetch(url(), opts2);

        // then
        assert.equal(res2.status, Number(expectedStatus), `Expected response status ${expectedStatus}, but got ${res2.status}`);
        switch(dateExpectation) {
          case 'same':       assert.equal(res2.headers.get('date'), res1.headers.get('date')); break;
          case 'changed': assert.notEqual(res2.headers.get('date'), res1.headers.get('date')); break;
          case 'N/A': /* not important - no assertion made about date values; the behaviour is undefined */ break;
          case 'race-condition': /* date may or may not have changed, depending on if the clock ticked between requests */ break;
          default: throw new Error(`Unrecognised value for dateExpectation: '${dateExpectation}'`);
        }
        // and
        expectedHeaders.forEach(([ name, expectedValue ]) => {
          assert.deepEqual(res1.headers.get(name), expectedValue, `Unexpected value for header ${name} of response 1`);
          assert.deepEqual(res2.headers.get(name), expectedValue, `Unexpected value for header ${name} of response 2`);
        });
      });
    }
  }
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
