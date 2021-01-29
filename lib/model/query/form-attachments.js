// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Form Attachments are files that are expected to exist given the XForms xml
// definition that the form was created with. See the instance/form-attachments
// file for more information.

const { map } = require('ramda');
const { Frame } = require('../frame');
const { FormAttachment } = require('../frames');

const getAllByFormDefId = (formDefId) => ({ all }) =>
  all(sql`select * from form_attachments where "formDefId"=${formDefId} order by name asc`)
    .then(map(FormAttachment.construct));

// TODO: bad name
const _unjoinMd5 = unjoiner(FormAttachment, Frame.define('md5', readable)); // TODO/SL: should readable be here?
const getAllByFormDefIdForOpenRosa = (formDefId) => ({ all }) => all(sql`
select ${_unjoinMd5.fields} from form_attachments
  left outer join (select id, md5 from blobs) as blobs on form_attachments."blobId"=blobs.id
  where "formDefId"=${formDefId}`)
  .then(map(_unjoinMd5));

const update = (fa) => ({ run }) => run(sql`
update form_attachments set "blobId"=${fa.blobId}, "updatedAt"=now()
  where "formId"=${fa.formId} and "formDefId"=${fa.formDefId} and name=${fa.name}`);

module.exports = { getAllByFormDefId, getAllByFormDefIdForOpenRosa, update };

