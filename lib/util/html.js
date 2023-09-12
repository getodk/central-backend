// Copyright 2023 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Helper functions that relate to the HTML/frontend layer of the application.

const config = require('config');

const envDomain = config.get('default.env.domain');

// handy dev function for enabling syntax hilighting of html
const html = ([ first, ...rest ], ...vars) => first + vars.map((v, idx) => [ v, rest[idx] ]).flat().join('');

// Style to look like odk-central-frontend
const frontendPage = ({ head='', body }) => html`
  <html>
    <head>
      ${head}
      <style>
        body { margin:0; font-family:"Helvetica Neue", Helvetica, Arial, sans-serif; background-color:#f7f7f7; }
        .header { background-color:#bd006b; color:white; box-shadow: 0 3px 0 #dedede; border-top: 3px solid #8d0050; padding:0.5em 0; }
        .header a,.header a:active,.header a:visited { margin:1em; font-size:12px; font-weight:700; color:white; text-decoration:none; }
        #content { margin:3em auto; width:80%; background-color:white; border-color:rgb(51, 51, 51); box-shadow:rgba(0, 0, 0, 0.25) 0px 0px 24px 0px, rgba(0, 0, 0, 0.28) 0px 35px 115px 0px; }
        #content h1 { background-color:#bd006b; color:white; border-bottom:1px solid #ddd; padding:10px 15px; font-size:18px; margin:0; }
        #content div { border-bottom:1px solid #ddd; padding:10px 15px; }
        #content div:last-child { border-bottom:none; background-color:#eee; }
        #content div:last-child a { background-color:#009ecc; color:white; display:inline-block; padding:6px 10px 5px; border-radius:2px; text-decoration:none; font-size:12px; border-color:#286090; }
        #content div:last-child a:hover { background-color:#0086ad; border-color:#204d74; }
        #content pre { white-space:pre-wrap; }
      </style>
    </head>
    <body>
      <div class="header"><a href="/">ODK Central</a></div>
      <div id="content">
        ${body}
      </div>
    </body>
  </html>
`;

// Logic adapted from `login.vue` in frontend.
const safeNextPathFrom = next => {
  if (!next) return '/#/';

  let url;
  try {
    url = new URL(next, envDomain);
  } catch (e) {
    return '/#/';
  }

  if (url.origin !== envDomain || url.pathname === '/login')
    return '/#/';

  // Don't modify enketo URLs
  if (url.pathname.startsWith('/-/')) return url.toString();

  // Append query string manually, because Central Frontend expects search/hash
  // in the wrong order (Vue hash-based routing).
  return '/#' + url.pathname + url.search + url.hash;
};

module.exports = { frontendPage, html, safeNextPathFrom };
