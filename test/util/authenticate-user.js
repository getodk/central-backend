// Allow main functionality to stay at top of file:
/* eslint-disable no-use-before-define */

const makeFetchCookie = require('fetch-cookie');

module.exports = async (service, user, includeCsrf) => {
  if (!user) throw new Error('Did you forget the **service** arg?');
  if (process.env.TEST_AUTH === 'oidc') {
    if (user.password) throw new Error('Password supplied but OIDC is enabled.');

    const username = typeof user === 'string' ? user : user.email.split('@')[0];
    const body = await oidcAuthFor(service, username);

    if (includeCsrf) return body;
    return body.token;
  } else {
    const credentials = (typeof user === 'string')
      ? { email: `${user}@getodk.org`, password: `password4${user}` }
      : user;
    const { body } = await service.post('/v1/sessions')
      .send(credentials)
      .expect(200);

    if (includeCsrf) return body;
    return body.token;
  }
};

async function oidcAuthFor(service, user) {
  const res1 = await service.get('/v1/oidc/login');

  // custom cookie jar probably not important, but we will need these cookies
  // for the final redirect
  const cookieJar = new makeFetchCookie.toughCookie.CookieJar();
  res1.headers['set-cookie'].forEach(cookieString => {
    cookieJar.setCookie(cookieString, 'http://localhost:8383/v1/oidc/login');
  });

  const location1 = res1.headers.location;

  const fetchC = makeFetchCookie(fetch, cookieJar);
  const res2 = await fetchC(location1);
  if (res2.status !== 200) throw new Error('Non-200 response');

  const location2 = await formActionFrom(res2);

  // TODO try replacing with FormData
  const body = require('querystring').encode({
    prompt: 'login',
    login: user,
    password: 'topSecret123',
  });
  const res3 = await fetchC(location2, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const location3 = await formActionFrom(res3);
  const body2 = require('querystring').encode({ prompt: 'consent' });
  const res4 = await fetchC(location3, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body2,
    redirect: 'manual',
  });
  if (res4.status !== 303) throw new Error('Expected 303!');

  const location4 = res4.headers.get('location');
  const res5 = await fetchC(location4, { redirect: 'manual' });
  const location5 = res5.headers.get('location');

  const u5 = new URL(location5);
  const servicePath = u5.pathname + u5.search;
  //const res6 = await service.get(servicePath, { headers:{ cookie:cookieJar.getCookieStringSync(location5) } });
  const res6 = await service.get(servicePath)
    .set('Cookie', cookieJar.getCookieStringSync(location5))
    .expect(200);

  const sessionId = getSetCookie(res6, 'session');
  const csrfToken = getSetCookie(res6, '__csrf');

  return { token: sessionId, csrf: csrfToken };
}

function getSetCookie(res, cookieName) {
  const setCookieHeader = res.headers['set-cookie'];
  if (!setCookieHeader) throw new Error(`Requested cookie '${cookieName}' was not found in Set-Cookie header!`);

  const prefix = `${cookieName}=`;
  return decodeURIComponent(setCookieHeader.find(h => h.startsWith(prefix)).substring(prefix.length).split(';')[0]);
}

async function formActionFrom(res) {
  const text = await res.text();
  return text.match(/<form.*\baction="([^"]*)"/)[1];
}
