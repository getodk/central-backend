// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { parseClientAudits } = require('../../../data/client-audits');
const { getFormFields } = require('../../../data/schema');
const { traverseXml, findOne, root, node, text } = require('../../../util/xml');

const up = (db) => new Promise((resolve, reject) => {
  const work = [];
  const stream = db.select({
    formXml: 'form_defs.xml',
    submissionXml: 'submission_defs.xml',
    submissionDefId: 'submission_defs.id'
  })
    .from('submission_defs')
    .innerJoin('form_defs', 'submission_defs.formDefId', 'form_defs.id')
    .stream();

  stream.on('data', ({ formXml, submissionXml, submissionDefId }) => {
    work.push(Promise.all([
      getFormFields(formXml),
      traverseXml(submissionXml, [ findOne(root(), node('meta'), node('audit'))(text()) ])
    ]).then(([ fields, [ auditNode ] ]) => {
      if (!auditNode.isDefined()) return;
      if (!fields.some((field) => (field.path === '/meta/audit') && (field.type === 'binary'))) return;

      // we have an audit node and we have a binding that indicates it's a binary.
      // so we need to mark it as a client audit and possibly process the file if
      // we have one.
      return db.update({ isClientAudit: true })
        .into('submission_attachments')
        .where({ submissionDefId, name: auditNode.get() })
        .returning('*')
        .then(([ attachment ]) => {
          if (attachment.blobId == null) return; // our work is done; there is no file.
          return db.select('content').from('blobs').where({ id: attachment.blobId })
            .then(([{ content }]) => parseClientAudits(content))
            .then((audits) => {
              for (const audit of audits) audit.blobId = attachment.blobId;
              return db.insert(audits).into('client_audits');
            });
        });
    }));
  });
  stream.on('error', reject);
  stream.on('end', () => { Promise.all(work).then(resolve); });
});

const down = () => {}; // no.

module.exports = { up, down };

