// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Here you will find a number of mustache templates that help formulate OpenRosa
// responses. There is one template for each possible response.

const { parse, render } = require('mustache');

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
const formList = template(200, `<?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
  {{#forms}}
    <xform>
      <formID>{{xmlFormId}}</formID>
      <name>{{name}}{{^name}}{{xmlFormId}}{{/name}}</name>
      <version>{{version}}</version>
      <hash>md5:{{hash}}</hash>
      <downloadUrl>{{{domain}}}{{{basePath}}}/forms/{{xmlFormId}}.xml</downloadUrl>
    </xform>
  {{/forms}}
  </xforms>`);

// Returns a generic error message with a nature of error. We do this not via the
// template infrastructure as much of it is extraneous for this simple templating task.
const openRosaErrorTemplate = openRosaMessageBase('error');
parse(openRosaErrorTemplate);
const openRosaError = (message) => render(openRosaErrorTemplate, { message });

module.exports = { createdMessage, formList, openRosaError };

