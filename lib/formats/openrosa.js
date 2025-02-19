// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Here you will find a number of mustache templates that help formulate OpenRosa
// responses. There is one template for each possible response.

const { mergeRight } = require('ramda');
const { parse, render } = require('mustache');
const { attachmentToDatasetName } = require('../util/util');

////////////////////////////////////////////////////////////////////////////////
// SETUP

// simple helper that precompiles the templates and merges the given data with env.
const template = (code, body) => {
  parse(body); // caches template for future perf.
  return (data) => ({ code, body: render(body, data) });
};


////////////////////////////////////////////////////////////////////////////////
// MESSAGES

// To be used in forming actual messages/templates.
const openRosaMessageBase = (nature = '{{nature}}', message = '{{message}}') => `
  <OpenRosaResponse xmlns="http://openrosa.org/http/response" items="0">
    <message nature="${nature}">${message}</message>
  </OpenRosaResponse>`;

// Returns an OpenRosa created response (critically with a 201 code). Takes
// nature and message, both optional.
const createdMessage = template(201, openRosaMessageBase());

// Takes forms: [Form] and optional basePath: String, returns an OpenRosa xformsList
// response. If basePath is given, it is inserted after domain in the downloadUrl.
const formListTemplate = template(200, `<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
  {{#forms}}
    <xform>
      <formID>{{xmlFormId}}</formID>
      <name>{{def.name}}{{^def.name}}{{xmlFormId}}{{/def.name}}</name>
      <version>{{def.version}}</version>
      <hash>md5:{{def.hash}}</hash>
      <downloadUrl>{{{domain}}}{{{basePath}}}/forms/{{urlSafeXmlFormId}}{{#draft}}/draft{{/draft}}.xml</downloadUrl>
      {{#aux.openRosa.hasAttachments}}
      <manifestUrl>{{{domain}}}{{{basePath}}}/forms/{{urlSafeXmlFormId}}{{#draft}}/draft{{/draft}}/manifest</manifestUrl>
      {{/aux.openRosa.hasAttachments}}
    </xform>
  {{/forms}}
  </xforms>`);
const formList = (data) => formListTemplate(mergeRight(data, {
  forms: data.forms.map((form) =>
    form.with({ urlSafeXmlFormId: encodeURIComponent(form.xmlFormId) }))
}));

const formManifestTemplate = template(200, `<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
  {{#attachments}}
    {{#hasSource}}
    <mediaFile{{#isDataset}} type="entityList"{{/isDataset}}>
      <filename>{{name}}</filename>
      <hash>md5:{{openRosaHash}}</hash>
      <downloadUrl>{{{domain}}}{{{basePath}}}/attachments/{{urlName}}</downloadUrl>
      {{#integrityUrl}}
      <integrityUrl>{{{integrityUrl}}}</integrityUrl>
      {{/integrityUrl}}
    </mediaFile>
    {{/hasSource}}
  {{/attachments}}
  </manifest>`);

// use the above template but encode all attachment names for output.
const formManifest = (data) => formManifestTemplate(mergeRight(data, {
  attachments: data.attachments.map((attachment) =>
    attachment.with({
      hasSource: attachment.blobId || attachment.datasetId,
      urlName: encodeURIComponent(attachment.name),
      isDataset: attachment.datasetId != null,
      integrityUrl: attachment.datasetId ?
        `${data.domain}${data.projectPath}/datasets/${encodeURIComponent(attachmentToDatasetName(attachment.name))}/integrity`
        : null
    }))
}));

// Returns a generic error message with a nature of error. We do this not via the
// template infrastructure as much of it is extraneous for this simple templating task.
const openRosaErrorTemplate = openRosaMessageBase('error');
parse(openRosaErrorTemplate);
const openRosaError = (message) => render(openRosaErrorTemplate, { message });

const entityListTemplate = template(200, `<?xml version="1.0" encoding="UTF-8"?>
  <data>
    <entities>
    {{#entities}}
      <entity id="{{uuid}}">
        <deleted>{{deleted}}</deleted>
      </entity>
    {{/entities}}
    </entities>
  </data>`);
const entityList = (data) => entityListTemplate(data);
module.exports = { createdMessage, formList, formManifest, openRosaError, entityList };

