// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { map } = require('ramda');
const { Blob } = require('../frames');
const { construct } = require('../../util/util');

// 1. there may be a better way to do this. with this approach, we always
//    ship the bits to the database, even if they're already in there. shipping
//    bits is expensive and slow.
//    (but the old select-insert way was two separate round-trips in the did-not-exist
//    case, which wasn't great either. and it has concurrency issues.)
// 2. we /have/ to do an update on conflict in order for values to return.
//    so we just set the sha back to what we already know it is.
const ensure = (blob) => ({ oneFirst }) => oneFirst(sql`
with ensured as
(insert into blobs (sha, md5, content, "contentType") values
    (${blob.sha}, ${blob.md5}, ${sql.binary(blob.content)}, ${blob.contentType || null})
  on conflict (sha) do update set sha = ${blob.sha}
  returning id)
select id from ensured`);

const getById = (blobId) => ({ maybeOne }) =>
  maybeOne(sql`select * from blobs where id=${blobId}`)
    .then(map(construct(Blob)));

module.exports = { ensure, getById };

