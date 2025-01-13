const fs = require('node:fs');
const { extname } = require('node:path');
const { Readable } = require('stream');
const { finished } = require('stream/promises');

async function apiClient(suiteName, { serverUrl, userEmail, userPassword, logPath }) {
  const log = require('./logger')(suiteName);

  let bearerToken;

  log.info('Creating session...');
  const { token } = await apiPostJson('sessions', { email:userEmail, password:userPassword }, { Authorization:null });
  // eslint-disable-next-line prefer-const
  bearerToken = token;

  return {
    apiGet,
    apiRawHead,
    apiRawGet,
    apiPostFile,
    apiPostJson,
    apiGetToFile,
    apiPostAndDump,
    apiPost,
    apiFetch,
  };

  async function apiGet(path, headers) {
    const res = await apiFetch('GET', path, undefined, headers);
    return res.json();
  }

  function apiRawHead(path, headers) {
    return apiFetch('HEAD', path, undefined, headers);
  }

  function apiRawGet(path, headers) {
    return apiFetch('GET', path, undefined, headers);
  }

  function apiPostFile(path, opts) {
    if(typeof opts === 'string') {
      return apiPostFile(path, {
        body: fs.readFileSync(opts),
        mimeType: mimetypeFor(opts),
      });
    } else {
      const { body, mimeType } = opts;
      return apiPost(path, body, { 'Content-Type':mimeType });
    }
  }

  function apiPostJson(path, body, headers) {
    return apiPost(path, JSON.stringify(body), { 'Content-Type':'application/json', ...headers });
  }

  function apiGetToFile(prefix, n, path, headers) {
    return fetchToFile(prefix, n, 'GET', path, undefined, headers);
  }

  function apiPostAndDump(prefix, n, path, body, headers) {
    return fetchToFile(prefix, n, 'POST', path, body, headers);
  }

  async function fetchToFile(filenamePrefix, n, method, apiPath, body, headers) {
    const res = await apiFetch(method, apiPath, body, headers);

    const filePath = `${logPath}/${filenamePrefix}.${n.toString().padStart(9, '0')}.dump`;
    const file = fs.createWriteStream(filePath);

    await finished(Readable.fromWeb(res.body).pipe(file));

    return fs.statSync(filePath).size;
  }

  async function apiPost(path, body, headers) {
    const res = await apiFetch('POST', path, body, headers);
    return res.json();
  }

  async function apiFetch(method, path, body, extraHeaders) {
    const url = `${serverUrl}/v1/${path}`;

    const Authorization = bearerToken ? `Bearer ${bearerToken}` : `Basic ${base64(`${userEmail}:${userPassword}`)}`;

    const headers = { Authorization, ...extraHeaders };
    // unset null/undefined Authorization value to prevent fetch() from stringifying it:
    if(headers.Authorization == null) delete headers.Authorization;

    const res = await fetch(url, {
      method,
      body,
      headers,
      redirect: 'manual',
    });
    log.debug(method, res.url, '->', res.status);

    // eslint-disable-next-line no-use-before-define
    if(isRedirected(res)) return new Redirect(res);
    if(!res.ok) {
      const responseStatus = res.status;
      const responseText = await res.text() || res.statusText;

      const err = new Error(`${responseStatus}: ${responseText}`);
      err.responseStatus = responseStatus;
      err.responseText = responseText;

      throw err;
    }
    return res;
  }
}

function base64(s) {
  return Buffer.from(s).toString('base64');
}

function mimetypeFor(f) {
  // For more, see: https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
  const extension = extname(f);
  switch(extension) {
    case '.bin' : return 'application/octet-stream';
    case '.jpg' : return 'image/jpeg';
    case '.png' : return 'image/png';
    case '.svg' : return 'image/svg+xml';
    case '.txt' : return 'text/plain';
    case '.xls' : return 'application/vnd.ms-excel';
    case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xml' : return 'application/xml';
    default: throw new Error(`Unsure what mime type to use for: ${f}`);
  }
}

function isRedirected(res) {
  // should support res.redirected, but maybe old version
  // See: https://www.npmjs.com/package/node-fetch#responseredirected
  return res.redirected || (res.status >=300 && res.status < 400);
}

class Redirect {
  constructor(res) {
    this.props = Object.freeze({
      status:   res.status,
      location: res.headers.get('location'),
      headers:  Object.freeze([...res.headers]),
    });
  }
  get status()   { return this.props.status; }
  get location() { return this.props.location; }
  get headers()  { return this.props.headers; }
}

module.exports = { apiClient, mimetypeFor, Redirect };
