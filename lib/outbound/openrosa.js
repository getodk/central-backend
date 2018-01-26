const { merge } = require('ramda');
const { parse, render } = require('mustache');
const config = require('config');

////////////////////////////////////////////////////////////////////////////////
// SETUP

// set up some basic information needed later: env vars are available to every
// template.
const env = config.get('default.env');

// simple helper that precompiles the templates and merges the given data with env.
const template = (body) => {
  parse(body); // caches template for future perf.
  return (code, data) => ({ code, body: render(body, merge(env, data)) });
};


////////////////////////////////////////////////////////////////////////////////
// MESSAGES

// Takes nature and message; returns a standard plain message.
const openRosaMessage = template(`
  <OpenRosaResponse xmlns="http://openrosa.org/http/response" items="0">
    <message nature="{{nature}}">{{message}}</message>
  </OpenRosaResponse>`);

// Takes forms: [Form] and optional basePath: String, returns an OpenRosa xformsList
// response. If basePath is given, it is inserted after domain in the downloadUrl.
const formList = template(`
  <?xml version="1.0" encoding="UTF-8"?>
  <xforms xmlns="http://openrosa.org/xforms/xformsList">
  {{#forms}}
    <xform>
      <formID>{{xmlFormId}}</formID>
      <name>{{name}}</name>
      <version>{{version}}</version>
      <hash>{{hash}}</hash>
      <downloadUrl>{{{domain}}}{{{basePath}}}/forms/{{xmlFormId}}.xml</downloadUrl>
    </xform>
  {{/forms}}
  </xforms>`);

module.exports = { openRosaMessage, formList };

