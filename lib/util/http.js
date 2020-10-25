// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Helper functions that relate to the HTTP/service layer of the application.

const url = require('url');
const { isBlank } = require('./util');


////////////////////////////////////////////////////////////////////////////////
// REQUEST PARSING

// Returns t/f only if the input is a string of any upper/lowercase combination.
const isTrue = (x) => (!isBlank(x) && (x.toLowerCase() === 'true'));
const isFalse = (x) => (!isBlank(x) && (x.toLowerCase() === 'false'));

// Returns just the pathname of the URL, omitting querystring and other non-path decoration.
const urlPathname = (x) => url.parse(x).pathname;


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


////////////////////////////////////////////////////////////////////////////////
// URL HELPERS

// Given any URL string which may or may not already have a querystring, returns a
// new URL string with the given query parameters set on it. The k/v object indicates
// the parameters to be set, except that if the value is null/undefined the parameter
// will be _unset_ even if it already existed on the input URL.
const urlWithQueryParams = (urlStr, set = {}) => {
  const obj = new url.URL(urlStr, 'http://opendatakit.org');
  const params = obj.searchParams;
  for (const key of Object.keys(set))
    if (set[key] == null)
      params.delete(key);
    else
      params.set(key, set[key]);
  obj.search = params.toString();
  return obj.pathname + obj.search;
};


module.exports = {
  isTrue, isFalse, urlPathname,
  serialize,
  success, contentType, xml, atom, json,
  urlWithQueryParams
};

