require('should');
const appRoot = require('app-root-path');
// eslint-disable-next-line import/no-dynamic-require
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
      data: null,
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
        referer: null,
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
      data: null,
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
      data: null,
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
  ],
  // URL with useful query parameters to preserve
  [
    {
      cookies: {
        csrftoken: 'j0,,U5',
        __enketo_meta_deviceid: 's..hAE',
        __csrf: 'tdg...12lwQ',
        session: 'RPPE..dUz'
      },
      data: '{}',
      headers: {
        'x-forwarded-proto': 'https',
        host: 'localhost:8383',
        connection: 'close',
        'sec-ch-ua': '" Not A;Brand";v="99", "Chromium";v="90", "Google Chrome";v="90"',
        accept: 'application/json, text/plain, */*',
        authorization: 'Bearer RPPEyOgimjSQY7rQfFDCcFLaySdCMRJflCunYoKoXpvh5JLB5nvrm4lju$QfSdUz',
        'sec-ch-ua-mobile': '?0',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        referer: 'http://localhost:8989/',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en-US,en;q=0.9',
        cookie: 'csrftoken=j0j32..6LEzgQU5; __enketo_meta_deviceid=s%3Alo...ucHhAE; __csrf=tdgs7t0..12lwQ; session=RPP..dUz'
      },
      method: 'GET',
      query_string: '%24top=250&%24skip=0&%24count=true&%24wkt=true&%24filter=__system%2FsubmitterId+eq+48+and+__system%2FreviewState+eq+null',
      url: 'http://localhost/v1/projects/3/forms/odata-fake-planets.svc/Submissions?%24top=250&%24skip=0&%24count=true&%24wkt=true&%24filter=__system%2FsubmitterId+eq+48+and+__system%2FreviewState+eq+null'
    }
    // eslint-disable-next-line comma-style
    ,
    {
      cookies: null,
      data: null,
      headers: {
        'x-forwarded-proto': 'https',
        host: 'localhost:8383',
        connection: 'close',
        'sec-ch-ua': '" Not A;Brand";v="99", "Chromium";v="90", "Google Chrome";v="90"',
        accept: 'application/json, text/plain, */*',
        authorization: null,
        'sec-ch-ua-mobile': '?0',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        referer: null,
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en-US,en;q=0.9',
        cookie: 'csrftoken, __enketo_meta_deviceid, __csrf, session'
      },
      method: 'GET',
      query_string: '%24top=250&%24skip=0&%24count=true&%24wkt=true&%24filter=__system%2FsubmitterId+eq+48+and+__system%2FreviewState+eq+null',
      url: 'http://localhost/v1/projects/3/forms/odata-fake-planets.svc/Submissions?%24top=250&%24skip=0&%24count=true&%24wkt=true&%24filter=__system%2FsubmitterId+eq+48+and+__system%2FreviewState+eq+null'
    }
  ],
  // Example of Enketo submission
  [
    {
      cookies: {
        csrftoken: 'j..5',
        __enketo_meta_deviceid: 's..AE',
        __csrf: 't..Q',
        session: 'RP..Uz'
      },
      data: '{"__csrf":"td..wQ"}',
      headers: {
        'x-forwarded-proto': 'https',
        host: 'localhost:8383',
        connection: 'close',
        'content-length': '619',
        date: 'Wed, 19 May 2021 21:59:37 GMT',
        'cache-control': 'max-age=0',
        'x-openrosa-version': '1.0',
        'content-type': 'multipart/form-data; boundary=----WebKitFormBoundaryL2oytYPxI0mUpe2B',
        'sec-ch-ua-mobile': '?0',
        'x-openrosa-instance-id': 'uuid:acc694d9-63af-4893-9d19-6877c3f39fa1',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36',
        'x-openrosa-deprecated-id': '',
        'sec-ch-ua': '" Not A;Brand";v="99", "Chromium";v="90", "Google Chrome";v="90"',
        accept: '*/*',
        origin: 'http://localhost:8989',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        referer: 'http://localhost:8989/-/XoecwziQ',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en-US,en;q=0.9',
        cookie: 'csrftoken=j0j3..QU5; __enketo_meta_deviceid=s%3Aloc..AE; __csrf=tdg..lwQ; session=RP..SdUz'
      },
      method: 'POST',
      query_string: null,
      url: 'http://localhost/v1/projects/5/submission'
    }
    // eslint-disable-next-line comma-style
    ,
    {
      cookies: null,
      data: null,
      headers: {
        'x-forwarded-proto': 'https',
        host: 'localhost:8383',
        connection: 'close',
        'content-length': '619',
        date: 'Wed, 19 May 2021 21:59:37 GMT',
        'cache-control': 'max-age=0',
        'x-openrosa-version': '1.0',
        'content-type': 'multipart/form-data; boundary=----WebKitFormBoundaryL2oytYPxI0mUpe2B',
        'sec-ch-ua-mobile': '?0',
        'x-openrosa-instance-id': 'uuid:acc694d9-63af-4893-9d19-6877c3f39fa1',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36',
        'x-openrosa-deprecated-id': '',
        'sec-ch-ua': '" Not A;Brand";v="99", "Chromium";v="90", "Google Chrome";v="90"',
        accept: '*/*',
        origin: 'http://localhost:8989',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        // eslint-disable-next-line key-spacing
        referer:  null,
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en-US,en;q=0.9',
        cookie: 'csrftoken, __enketo_meta_deviceid, __csrf, session'
      },
      method: 'POST',
      query_string: null,
      url: 'http://localhost/v1/projects/5/submission'
    }
  ],
  // Example of Enketo public access link (showing form)
  [
    {
      cookies: {
        __enketo_meta_deviceid: 's:localhost:ZzE...hFp4',
        _csrf: 'W...Ua'
      },
      data: '{}',
      headers: {
        'x-forwarded-proto': 'https',
        host: 'localhost:8383',
        connection: 'close',
        'content-length': '0',
        cookie: '__enketo_meta_deviceid=s%3Aloc..p4; _csrf=W_..Ua',
        'x-openrosa-version': '1.0',
        date: 'Mon, 14 Jun 2021 18:47:25 GMT'
      },
      method: 'HEAD',
      query_string: 'formID=simple-name-age&st=Cpl...62M0d',
      url: 'http://localhost/v1/projects/5/formList?formID=simple-name-age&st=Cpl..M0d'
    },
    {
      cookies: null,
      data: null,
      headers: {
        'x-forwarded-proto': 'https',
        host: 'localhost:8383',
        connection: 'close',
        'content-length': '0',
        cookie: '__enketo_meta_deviceid, _csrf',
        'x-openrosa-version': '1.0',
        date: 'Mon, 14 Jun 2021 18:47:25 GMT'
      },
      method: 'HEAD',
      query_string: null,
      url: 'http://localhost/v1/projects/5/formList'
    }
  ],
  // Example of Enketo public access link (submitting form)
  [
    {
      cookies: {
        __enketo_meta_deviceid: 's:localhost:Zz...p4',
        _csrf: 'W_..Ua'
      },
      data: '{}',
      headers: {
        'x-forwarded-proto': 'https',
        host: 'localhost:8383',
        connection: 'close',
        'content-length': '460',
        date: 'Mon, 14 Jun 2021 19:05:52 GMT',
        'cache-control': 'max-age=0',
        'x-openrosa-version': '1.0',
        'content-type': 'multipart/form-data; boundary=----WebKitFormBoundaryAhdIGqG3gmVb17IB',
        'sec-ch-ua-mobile': '?0',
        'x-openrosa-instance-id': 'uuid:4c1129d2-cf06-4cda-bde9-645340368dea',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36',
        'x-openrosa-deprecated-id': '',
        'sec-ch-ua': '" Not;A Brand";v="99", "Google Chrome";v="91", "Chromium";v="91"',
        accept: '*/*',
        origin: 'http://localhost:8989',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        referer: 'http://localhost:8989/-/single/Xo..iQ?st=Cp...d',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en-US,en;q=0.9',
        cookie: '__enketo_meta_deviceid=s%3Alocalhost%3AZzEustWflva1byvA.R..p4; _csrf=W_..a'
      },
      method: 'POST',
      query_string: 'st=Cpl...M0d',
      url: 'http://localhost/v1/projects/5/submission?st=Cpl...M0d'
    },
    {
      cookies: null,
      data: null,
      headers: {
        'x-forwarded-proto': 'https',
        host: 'localhost:8383',
        connection: 'close',
        'content-length': '460',
        date: 'Mon, 14 Jun 2021 19:05:52 GMT',
        'cache-control': 'max-age=0',
        'x-openrosa-version': '1.0',
        'content-type': 'multipart/form-data; boundary=----WebKitFormBoundaryAhdIGqG3gmVb17IB',
        'sec-ch-ua-mobile': '?0',
        'x-openrosa-instance-id': 'uuid:4c1129d2-cf06-4cda-bde9-645340368dea',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36',
        'x-openrosa-deprecated-id': '',
        'sec-ch-ua': '" Not;A Brand";v="99", "Google Chrome";v="91", "Chromium";v="91"',
        accept: '*/*',
        origin: 'http://localhost:8989',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        referer: null,
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en-US,en;q=0.9',
        cookie: '__enketo_meta_deviceid, _csrf'
      },
      method: 'POST',
      query_string: null,
      url: 'http://localhost/v1/projects/5/submission'
    }
  ],
  // Example of Enketo public access link (both key and ?st token in query string)
  [
    {
      cookies: {
        __enketo_meta_deviceid: 's:localhost:Zz..4',
        _csrf: 'W..Ua'
      },
      data: '{}',
      headers: {
        'x-forwarded-proto': 'https',
        host: 'localhost:8383',
        connection: 'close',
        'content-length': '0',
        cookie: '__enketo_meta_deviceid=s%3Alocalhost%3AZz..Fp4; _csrf=W..Ua',
        'x-openrosa-version': '1.0',
        date: 'Mon, 14 Jun 2021 19:08:30 GMT'
      },
      method: 'HEAD',
      query_string: 'formID=simple-name-age&st=CplI..0d',
      url: 'http://localhost/v1/key/Cpl.0d/projects/5/formList?formID=simple-name-age&st=Cpl...M0d'
    },
    {
      cookies: null,
      data: null,
      headers: {
        'x-forwarded-proto': 'https',
        host: 'localhost:8383',
        connection: 'close',
        'content-length': '0',
        cookie: '__enketo_meta_deviceid, _csrf',
        'x-openrosa-version': '1.0',
        date: 'Mon, 14 Jun 2021 19:08:30 GMT'
      },
      method: 'HEAD',
      query_string: null,
      url: 'http://localhost/v1/key/[FILTERED]/projects/5/formList'
    }
  ],
  // Example of X-Action-Notes header being removed
  [
    {
      cookies: {},
      data: '{"displayName":"Test Display Name"}',
      headers: {
        host: 'localhost:8383',
        'user-agent': 'HTTPie/2.4.0',
        'accept-encoding': 'gzip, deflate',
        accept: 'application/json, */*;q=0.5',
        connection: 'keep-alive',
        'content-type': 'application/json',
        'x-action-notes': 'some test note',
        authorization: 'Bearer Ojz....1I',
        'content-length': '36'
      },
      method: 'POST',
      query_string: null,
      url: 'http://localhost/v1/projects/3/forms/simple-form/public-links'
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
        'x-action-notes': null,
        authorization: null,
        'content-length': '36'
      },
      method: 'POST',
      query_string: null,
      url: 'http://localhost/v1/projects/3/forms/simple-form/public-links'
    }
  ]
];

// sensitive endpoints where querystrings need to be removed
const sensitiveEndpoints = [
  ['GET', '/v1/users?q=personal_name'],
  ['GET', '/v1/projects/6/forms/formid/submissions.csv?keyid=pass'],
  ['GET', '/v1/projects/6/forms/formid/submissions.csv.zip?keyid=pass'],
  ['GET', '/v1/projects/6/forms/formid/draft/submissions.csv?keyid=pass'],
  ['GET', '/v1/projects/6/forms/formid/draft/submissions.csv.zip?keyid=pass'],
  ['HEAD', '/v1/projects/6/formList?formID=my_form_id&st=enketo_token'],
  ['POST', '/v1/projects/6/submission?st=enketo_token']
];

// non-sensitive endpoints to send along useful querystrings
const nonSensitiveEndpoints = [
  ['GET', '/v1/users/reset/initiate?invalidate=true'],
  ['POST', '/v1/projects/6/forms/formid/submissions.csv?attachments=false'],
  ['POST', '/v1/projects/6/forms/formid/submissions.csv.zip?attachments=false'],
  ['POST', '/v1/projects/6/forms/formid/draft/submissions.csv?attachments=false'],
  ['POST', '/v1/projects/6/forms/formid/draft/submissions.csv.zip?attachments=false'],
];

const filteredTokenUrls = [
  ['/v1/key/APP_USER_KEY/projects/3/formList', '/v1/key/[FILTERED]/projects/3/formList'],
  ['/v1/test/DRAFT_TOKEN/projects/3/forms/draft/submission', '/v1/test/[FILTERED]/projects/3/forms/draft/submission'],
  ['/v1/projects/2/forms/test/attachments', '/v1/projects/2/forms/test/attachments'], // the form ID is 'test' but doesn't get filtered
  ['/v1/key/PUBLIC_ACCESS_KEY/projects/5/formList?formID=form_id&st=PUBLIC_ACCESS_KEY', '/v1/key/[FILTERED]/projects/5/formList?formID=form_id&st=PUBLIC_ACCESS_KEY'] // query string removal is not in the filtering step
];

describe('external: sanitize-sentry', () => {
  it('removes sensitive data from request objects ', () => {
    for (const [input, expectedOutput] of cases) {
      sanitizeEventRequest({ request: input }).should.eql({ request: expectedOutput });
    }
  });

  it('identifies sensitive URLs ', () => {
    for (const [method, url] of sensitiveEndpoints) {
      // eslint-disable-next-line object-curly-spacing
      isSensitiveEndpoint({url, method}).should.equal(true);
    }
  });

  it('identifies non-sensitive URLs ', () => {
    for (const [method, url] of nonSensitiveEndpoints) {
      // eslint-disable-next-line object-curly-spacing
      isSensitiveEndpoint({url, method}).should.equal(false);
    }
  });

  it('filters app user and draft tokens from URLs', () => {
    for (const [inputUrl, expectedUrl ] of filteredTokenUrls) {
      filterTokenFromUrl(inputUrl).should.equal(expectedUrl);
    }
  });
});

