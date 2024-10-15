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

describe('#1157 - Backend crash when opening hostile-named submission detail', () => {
  let api, projectId, xmlFormId, xmlFormVersion; // eslint-disable-line one-var, one-var-declaration-per-line

  it('should handle weird submission instanceId gracefully', async () => {
    // given
    api = await apiClient(SUITE_NAME, { serverUrl, userEmail, userPassword });
    projectId = await createProject();
    await uploadForm('test-form.xml');
    // and
    const goodSubmissionId = 'good-id';
    await uploadSubmission(goodSubmissionId);

    // expect 200:
    await api.apiGet(`projects/${projectId}/forms/${encodeURIComponent(xmlFormId)}.svc/Submissions('${goodSubmissionId}')`);

    // given
    const badSubmissionId = 'bad-id:';
    await uploadSubmission(badSubmissionId);
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

  async function createProject() {
    const project = await api.apiPostJson(
      'projects',
      { name:`standard-test-${new Date().toISOString().replace(/\..*/, '')}` },
    );
    return project.id;
  }

  async function uploadForm(xmlFilePath) {
    const res = await api.apiPostFile(`projects/${projectId}/forms?publish=true`, xmlFilePath);
    xmlFormId = res.xmlFormId;
    xmlFormVersion = res.version;
  }

  function uploadSubmission(submissionId) {
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
});
