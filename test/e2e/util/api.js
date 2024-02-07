const fs = require('node:fs');
const fetch = require('node-fetch'); // TODO replace with native fetch
const { basename } = require('node:path');

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

  function apiPostFile(path, filePath) {
    const mimeType = mimetypeFor(filePath);
    const blob = fs.readFileSync(filePath);
    return apiPost(path, blob, { 'Content-Type':mimeType });
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

  async function fetchToFile(filenamePrefix, n, method, path, body, headers) {
    const res = await apiFetch(method, path, body, headers);

    return new Promise((resolve, reject) => {
      try {
        let bytes = 0;
        res.body.on('data', data => bytes += data.length);
        res.body.on('error', reject);

        const file = fs.createWriteStream(`${logPath}/${filenamePrefix}.${n.toString().padStart(9, '0')}.dump`);
        res.body.on('end', () => file.close(() => resolve(bytes)));

        file.on('error', reject);

        res.body.pipe(file);
      } catch(err) {
        console.log(err);
        process.exit(99);
      }
    });
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
    if(!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res;
  }
}

function base64(s) {
  return Buffer.from(s).toString('base64');
}

function mimetypeFor(f) {
  // For more, see: https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
  const extension = fileExtensionFrom(f);
  switch(extension) {
    case 'bin' : return 'application/octet-stream';
    case 'jpg' : return 'image/jpeg';
    case 'png' : return 'image/png';
    case 'svg' : return 'image/svg+xml';
    case 'txt' : return 'text/plain';
    case 'xls' : return 'application/vnd.ms-excel';
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'xml' : return 'application/xml';
    default: throw new Error(`Unsure what mime type to use for: ${f}`);
  }
}

function fileExtensionFrom(f) {
  try {
    return basename(f).match(/\.([^.]*)$/)[1];
  } catch(err) {
    throw new Error(`Could not get file extension from filename '${f}'!`);
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
      headers:  Object.freeze(res.headers.raw()),
    });
  }
  get status()   { return this.props.status; }
  get location() { return this.props.location; }
  get headers()  { return this.props.headers; }
}

module.exports.Redirect = { apiClient, mimetypeFor, Redirect };
