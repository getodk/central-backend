require('should');
const appRoot = require('app-root-path');
const { sanitizeEventRequest, isSensitiveEndpoint, filterTokenFromUrl } = require(appRoot + '/lib/external/sentry');

// These cases are based on real requests!
const cases = [
  // Request body with sensitive data
  [
    {
      cookies: {},
      data: '{"email":"test-email","password":"test-pass"}',
      headers: {
        host: 'localhost:8383',
        'user-agent': 'HTTPie/2.4.0',
        'accept-encoding': 'gzip, deflate',
        accept: 'application/json, */*;q=0.5',
        connection: 'keep-alive',
        'content-type': 'application/json',
        'content-length': '48'
      },
      method: 'POST',
      query_string: null,
      url: 'http://localhost/v1/sessions'
    },
    {
      cookies: null,
      data: null,
      headers: {
        host: 'localhost:8383',
        'user-agent': 'HTTPie/2.4.0',
        'accept-encoding': 'gzip, deflate',
        accept: 'application/json, */*;q=0.5',
        connection: 'keep-alive',
        'content-type': 'application/json',
        'content-length': '48'
      },
      method: 'POST',
      query_string: null,
      url: 'http://localhost/v1/sessions'
    }
  ],
  // Authorization header
  [
   {
      cookies: {},
      data: '{}',
      headers: {
        host: 'localhost:8383',
        'user-agent': 'HTTPie/2.4.0',
        'accept-encoding': 'gzip, deflate',
        accept: '*/*',
        connection: 'keep-alive',
        authorization: 'Bearer sdff.....sdQ'
      },
      method: 'GET',
      query_string: null,
      url: 'http://localhost/v1/projects/3/forms'
    },
    {
      cookies: null,
      data: '{}',
      headers: {
        host: 'localhost:8383',
        'user-agent': 'HTTPie/2.4.0',
        'accept-encoding': 'gzip, deflate',
        accept: '*/*',
        connection: 'keep-alive',
        authorization: null
      },
      method: 'GET',
      query_string: null,
      url: 'http://localhost/v1/projects/3/forms'
    }
  ],
  // Cookies and query strings from the frontend
  [
    {
      cookies: {
        csrftoken: 'j0j...U5',
        __enketo_meta_deviceid: 's:localhost:zgC...hAE',
        __csrf: 'kGa...w1d',
        session: 'Aj...nR'
      },
      data: '{}',
      headers: {
        'x-forwarded-proto': 'https',
        host: 'localhost:8383',
        connection: 'close',
        'sec-ch-ua': '" Not A;Brand";v="99", "Chromium";v="90", "Google Chrome";v="90"',
        'sec-ch-ua-mobile': '?0',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-user': '?1',
        'sec-fetch-dest': 'document',
        referer: 'http://localhost:8989/',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en-US,en;q=0.9',
        cookie: 'csrftoken=j0j3....QU5; __enketo_meta_deviceid=s%3Alocalhost%3AzgCh....AE; __csrf=kG2...1d; session=Ajp....vjSnR'
      },
      method: 'GET',
      query_string: '%24filter=__system%2FsubmitterId+eq+26+and+__system%2FreviewState+eq+null',
      url: 'http://localhost/v1/projects/3/forms/odata-fake-planets/submissions.csv.zip?%24filter=__system%2FsubmitterId+eq+26+and+__system%2FreviewState+eq+null'
    },
    {
      cookies: null,
      data: null,
      headers: {
        'x-forwarded-proto': 'https',
        host: 'localhost:8383',
        connection: 'close',
        'sec-ch-ua': '" Not A;Brand";v="99", "Chromium";v="90", "Google Chrome";v="90"',
        'sec-ch-ua-mobile': '?0',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-user': '?1',
        'sec-fetch-dest': 'document',
        referer: 'http://localhost:8989/',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en-US,en;q=0.9',
        cookie: 'csrftoken, __enketo_meta_deviceid, __csrf, session'
      },
      method: 'GET',
      query_string: null,
      url: 'http://localhost/v1/projects/3/forms/odata-fake-planets/submissions.csv.zip'
    }
  ],
  // URL with draft form token
  [
    {
      cookies: {},
      data: '{}',
      headers: {
        host: 'localhost:8383',
        'user-agent': 'HTTPie/2.4.0',
        'accept-encoding': 'gzip, deflate',
        accept: '*/*',
        connection: 'keep-alive',
        'x-openrosa-version': '1.0',
        'content-type': 'multipart/form-data; boundary=58a8898824454fadb1e9d19fac47882c',
        'content-length': '311'
      },
      method: 'POST',
      query_string: null,
      url: 'http://localhost/v1/test/qiswR....yc9u/projects/3/forms/draft/submission'
    },
    {
      cookies: null,
      data: '{}',
      headers: {
        host: 'localhost:8383',
        'user-agent': 'HTTPie/2.4.0',
        'accept-encoding': 'gzip, deflate',
        accept: '*/*',
        connection: 'keep-alive',
        'x-openrosa-version': '1.0',
        'content-type': 'multipart/form-data; boundary=58a8898824454fadb1e9d19fac47882c',
        'content-length': '311'
      },
      method: 'POST',
      query_string: null,
      url: 'http://localhost/v1/test/[FILTERED]/projects/3/forms/draft/submission'
    }
  ],
  // URL with app user token
  [
    {
      cookies: {},
      data: '{}',
      headers: {
        host: 'localhost:8383',
        'user-agent': 'HTTPie/2.4.0',
        'accept-encoding': 'gzip, deflate',
        accept: '*/*',
        connection: 'keep-alive',
        'x-openrosa-version': '1.0',
        'content-type': 'text/xml'
      },
      method: 'GET',
      query_string: null,
      url: 'http://localhost/v1/key/rf9......7i/projects/3/formList'
    },
    {
      cookies: null,
      data: '{}',
      headers: {
        host: 'localhost:8383',
        'user-agent': 'HTTPie/2.4.0',
        'accept-encoding': 'gzip, deflate',
        accept: '*/*',
        connection: 'keep-alive',
        'x-openrosa-version': '1.0',
        'content-type': 'text/xml'
      },
      method: 'GET',
      query_string: null,
      url: 'http://localhost/v1/key/[FILTERED]/projects/3/formList'
    }
  ]
];

const sensitiveUrls = [
  '/v1/config/backups/initiate',
  '/v1/backup',
  '/v1/sessions',
  '/v1/sessions/some-token', // DELETE
  '/v1/users',
  '/v1/users/123',
  '/v1/users/reset/initiate',
  '/v1/users/reset/verify',
  '/v1/users/123/password'
];

const nonSensitiveUrls = [
  '/v1/key/8s_key_7i/projects/3/formList'
];

const filteredTokenUrls = [
  ['/v1/key/APP_USER_KEY/projects/3/formList', '/v1/key/[FILTERED]/projects/3/formList'],
  ['/v1/test/DRAFT_TOKEN/projects/3/forms/draft/submission', '/v1/test/[FILTERED]/projects/3/forms/draft/submission'],
  ['/v1/projects/2/forms/test/attachments', '/v1/projects/2/forms/test/attachments'], // the form ID is 'test' but doesn't get filtered
]

describe('external: sanitize-sentry', () => {
  it('removes sensitive data from request objects ', () => {
    for (const [input, expectedOutput] of cases) {
      sanitizeEventRequest({ request: input }).should.eql({ request: expectedOutput });
    }
  });

  it('identifies sensitive URLs ', () => {
    for (const url of sensitiveUrls) {
      isSensitiveEndpoint(url).should.equal(true);
    }
  });

  it('identifies non-sensitive URLs ', () => {
    for (const url of nonSensitiveUrls) {
      isSensitiveEndpoint(url).should.equal(false);
    }
  });

  it('filters app user and draft tokens from URLs', () => {
    for (const [inputUrl, expectedUrl ] of filteredTokenUrls) {
      filterTokenFromUrl(inputUrl).should.equal(expectedUrl);
    }
  });
});

