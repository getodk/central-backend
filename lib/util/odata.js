// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Helper functions that relate to the OData formatting

const { max } = Math;
const Problem = require('./problem');
const { parse, render } = require('mustache');
const { isTrue, urlWithQueryParams } = require('./http');

const template = (body) => {
  parse(body); // caches template for future perf.
  return (data) => render(body, data);
};

const extractPaging = (query) => {
  const parsedLimit = parseInt(query.$top, 10);
  const limit = Number.isNaN(parsedLimit) ? Infinity : parsedLimit;
  const offset = parseInt(query.$skip, 10) || 0;
  const shouldCount = isTrue(query.$count);
  const result = { limit: max(0, limit), offset: max(0, offset), shouldCount };

  return Object.assign(result, { doLimit: Infinity, doOffset: 0 });
};

const stripWhitespace = (x) => x.replace(/\n */g, '');

const jsonDataFooter = template(stripWhitespace(`
  "@odata.context":"{{{domain}}}{{{serviceRoot}}}/$metadata#{{table}}"
  {{#nextUrl}},"@odata.nextLink":"{{{domain}}}{{{nextUrl}}}"{{/nextUrl}}
  {{#count}},"@odata.count":{{count}}{{/count}}
}`));

const getServiceRoot = (subpath) => {
  const match = /\.svc\//i.exec(subpath);
  if (match == null) throw Problem.user.notFound(); // something else? shouldn't be possible.
  return subpath.slice(0, match.index + 4); // .svc <- len is 4
};

const nextUrlFor = (limit, offset, count, originalUrl) =>
  ((offset + limit >= count)
    ? null
    : urlWithQueryParams(originalUrl, { $skip: (offset + limit), $top: null }));


const extractOptions = (query) => ({
  wkt: isTrue(query.$wkt),
  expand: query.$expand,
  metadata: query.$select !== '*' && query.$select?.split(',')
    .map(p => p.trim())
    .filter(p => p.startsWith('__'))
    .reduce((map, field) => ({ ...map, [field]: true }), Object.create(null))
});


module.exports = {
  nextUrlFor, getServiceRoot, jsonDataFooter,
  extractPaging, extractOptions
};
