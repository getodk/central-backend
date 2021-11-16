// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Helper functions that relate to the HTTP/service layer of the application.

const { parse, URL } = require('url');
const { isBlank } = require('./util');
const sanitize = require('sanitize-filename');


////////////////////////////////////////////////////////////////////////////////
// REQUEST PARSING

// Returns t/f only if the input is a string of any upper/lowercase combination.
const isTrue = (x) => (!isBlank(x) && (x.toLowerCase() === 'true'));
const isFalse = (x) => (!isBlank(x) && (x.toLowerCase() === 'false'));

// Returns just the pathname of the URL, omitting querystring and other non-path decoration.
const urlPathname = (x) => parse(x).pathname;


////////////////////////////////////////////////////////////////////////////////
// RESPONSE DATA

// Standard simple serializer for object output.
// Behaves a little differently at the root call vs nested; because we want eg
// Array[User] to automatically serialize each User, we want to delve into the
// list and rerun the serializer for each entry given an Array. But we don't want
// to individually serialize plain objects to text or we end up with an array
// of JSON strings.
const _serialize = (isRoot) => (obj) => {
  if (Buffer.isBuffer(obj))
    return obj;
  else if ((obj === null) || (obj === undefined))
    return obj;
  else if (typeof obj.forApi === 'function')
    return obj.forApi();
  else if (Array.isArray(obj))
    return obj.map(_serialize(false));
  else if (typeof obj === 'string')
    return obj;

  return isRoot ? JSON.stringify(obj) : obj;
};
const serialize = _serialize(true);


////////////////////////////////////////////////////////////////////////////////
// OUTPUT HELPERS

// A easy way of terminating a Promise chain with a standard { success: true } response,
// as in .then(dosomething).then(dosomething).then(success).
const success = () => ({ success: true });

// A helper that wraps some resource result object with machinery that will set
// the response contentType to the given type. Curried so that the below xml/atom/json
// helpers can be defined.
const contentType = (type) => (result) => (_, response) => {
  response.type(type);
  return result;
};
const xml = contentType('application/xml');
const atom = contentType('application/atom+xml');
const json = contentType('application/json');


////////////////////////////////////////
//  content-disposition helpers

// to encode the filename* Content-Disposition field. copied (name, comments, and all) from MDN:
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent#encoding_for_content-disposition_and_link_headers
const encodeRFC5987ValueChars = (str) =>
  encodeURIComponent(str)
    // Note that although RFC3986 reserves "!", RFC5987 does not,
    // so we do not need to escape it
    .replace(/['()]/g, escape) // i.e., %27 %28 %29
    .replace(/\*/g, '%2A')
    // The following are not required for percent-encoding per RFC5987,
    // so we can allow for a little better readability over the wire: |`^
    .replace(/%(?:7C|60|5E)/g, unescape);

const sanitizeToAscii = (str) => str.replace(/[^\x00-\x7F]+/g, '-'); //  eslint-disable-line no-control-regex

const contentDisposition = (filename) => {
  const sanitized = sanitize(filename);
  return `attachment; filename="${sanitizeToAscii(sanitized)}"; filename*=UTF-8''${encodeRFC5987ValueChars(sanitized)}`;
};

//  content-disposition helpers
////////////////////////////////////////

const binary = (type, name, content) => (_, response) => {
  response.set('Content-Disposition', contentDisposition(name));
  response.set('Content-Type', type);
  return content;
};

class Redirect { constructor(code, url) { this.code = code; this.url = url; } }
const redirect = (x, y) => {
  if (y === undefined) {
    if (typeof x === 'number')
      return (to) => { throw new Redirect(x, to); };
    else
      throw new Redirect(301, x);
  }
  throw new Redirect(x, y);
};
redirect.isRedirect = (x) => x instanceof Redirect;


////////////////////////////////////////////////////////////////////////////////
// URL HELPERS

// Given any URL string which may or may not already have a querystring, returns a
// new URL string with the given query parameters set on it. The k/v object indicates
// the parameters to be set, except that if the value is null/undefined the parameter
// will be _unset_ even if it already existed on the input URL.
const urlWithQueryParams = (urlStr, set = {}) => {
  const obj = new URL(urlStr, 'http://getodk.org');
  const params = obj.searchParams;
  for (const key of Object.keys(set))
    if (set[key] == null)
      params.delete(key);
    else
      params.set(key, set[key]);
  obj.search = params.toString();
  return obj.pathname + obj.search;
};

const url = (strings, ...parts) => {
  const result = [];
  let i = 0;
  for (; i < parts.length; i += 1)
    result.push(strings[i], encodeURIComponent(parts[i]));
  result.push(strings[i]);
  return result.join('');
};


module.exports = {
  isTrue, isFalse, urlPathname,
  serialize,
  success, contentType, xml, atom, json, contentDisposition, binary, redirect,
  urlWithQueryParams, url
};

