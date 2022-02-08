// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
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

// NOTE: copypasta alert!
// The migration 20220121-02-purge-deleted-forms.js also contains a version
// of the following purge blob query, and if it changes here, it should likely
// change there, too.
const purgeUnattached = () => ({ all }) =>
  all(sql`
delete from blobs
  using blobs as b
  left join client_audits as ca on ca."blobId" = b.id
  left join submission_attachments as sa on sa."blobId" = b.id
  left join form_attachments as fa on fa."blobId" = b.id
  left join form_defs as fd on fd."xlsBlobId" = b.id
where (blobs.id = b.id and
  ca."blobId" is null and
  sa."blobId" is null and
  fa."blobId" is null and
  fd."xlsBlobId" is null)`);

module.exports = { ensure, getById, purgeUnattached };

