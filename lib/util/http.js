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
const { map, tryCatch } = require('ramda');
const { isBlank } = require('./util');
const Option = require('./option');
const sanitize = require('sanitize-filename');


////////////////////////////////////////////////////////////////////////////////
// REQUEST PARSING

// Returns t/f only if the input is a string of any upper/lowercase combination.
const isTrue = (x) => (!isBlank(x) && typeof x === 'string' && (x.toLowerCase() === 'true'));
const isFalse = (x) => (!isBlank(x) && typeof x === 'string' && (x.toLowerCase() === 'false'));

// Returns just the pathname of the URL, omitting querystring and other non-path decoration.
const urlPathname = (x) => parse(x).pathname;

const urlDecode = tryCatch(map(Option.of, decodeURIComponent), Option.none);


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

// Checks Etag in the request if it matches serverEtag then returns 304
// Otherwise executes given function 'fn'
const withEtag = (serverEtag, fn) => (request, response) => {

  response.set('ETag', `"${serverEtag}"`);

  // Etag logic inspired from https://stackoverflow.com/questions/72334843/custom-computed-etag-for-express-js/72335674#72335674
  const clientEtag = request.get('If-None-Match');
  if (clientEtag?.includes(serverEtag)) { // nginx weakens Etag when gzip is used, so clientEtag is like W/"4e9f0c7e9a8240..."
    response.status(304);
    return;
  }
  return fn();
};

module.exports = {
  isTrue, isFalse, urlPathname,
  success, contentType, xml, atom, json, contentDisposition, redirect,
  urlWithQueryParams, url, urlDecode,
  withEtag
};

