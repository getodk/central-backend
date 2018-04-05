// Helper functions that relate to the HTTP/service layer of the application.

const { inspect } = require('util');
const { DateTime } = require('luxon');
const url = require('url');
const { isBlank } = require('./util');


////////////////////////////////////////////////////////////////////////////////
// REQUEST PARSING

const isTrue = (x) => (!isBlank(x) && (x.toLowerCase() === 'true'));
const urlPathname = (x) => url.parse(x).pathname;


////////////////////////////////////////////////////////////////////////////////
// RESPONSE DATA

// Standard simple serializer for object output.
const serialize = (obj) => {
  if (Buffer.isBuffer(obj))
    return obj;
  else if ((obj === null) || (obj === undefined))
    return obj;
  else if (typeof obj.forApi === 'function')
    return obj.forApi();
  else if (Array.isArray(obj))
    return obj.map(serialize);
  else if (typeof obj === 'string')
    return obj;

  return JSON.stringify(obj);
};


////////////////////////////////////////////////////////////////////////////////
// OUTPUT HELPERS

const success = () => ({ success: true });

const contentType = (type) => (result) => (_, response) => {
  response.type(type);
  return result;
};
const xml = contentType('application/xml');
const atom = contentType('application/atom+xml');
const json = contentType('application/json');


////////////////////////////////////////////////////////////////////////////////
// URL HELPERS

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
  isTrue, urlPathname,
  serialize,
  success, contentType, xml, atom, json,
  urlWithQueryParams
}

