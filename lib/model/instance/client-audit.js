// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { always } = require('ramda');
const Instance = require('./instance');
const { createReadStream } = require('fs');
const { headers, parseClientAudits } = require('../../data/client-audits');
const { resolve } = require('../../util/promise');


module.exports = Instance('client_audits', {
  all: [ 'blobId' ].concat(headers),
  readable: [] // not available over API anyway.
})(({ simply, blobs, Blob, clientAudits, ClientAudit, submissionAttachments, SubmissionAttachment }) => class {

  // given the SubmissionDef, a filename (as expressed by the submission xml), and
  // optienally a local path to the actual csv itself, will perform as many of these
  // tasks as it can and should:
  // 1. create an expected attachment slot marked as a client audit.
  // 2. store the blob in the database iff it does not already exist.
  // 3. parse the csv and store in the client_audits table iff it has not been done.
  // it's tricky to manage this process, because of various interleaved data requirements
  // (eg we can't store records in client_audits before we have a blobId), and also
  // some possible corner cases (eg we have been given a blob before but /not/ as
  // part of a client audit, so we didn't parse it, but now we do; but neither do
  // we want to end up parsing it twice and duplicating records).
  // TODO: it's not great that we directly manipulate blobs here, but it saves one
  // database request to synthesize two fetches together.
  static intake(submissionDef, filename, localpath = null) {
    const createSlot = (blobId = null) => submissionAttachments.create(new SubmissionAttachment({
      submissionDefId: submissionDef.id, blobId, name: filename, isClientAudit: true
    }));

    // there's very little to do if we don't have a file on hand.
    return (localpath == null)
      ? createSlot()
      : ClientAudit.attachFromFile(localpath).then(createSlot);
  }
  // only does #2/3 from above, for the case that an attachment slot already exists.
  // TODO: reads the file from disk twice over. could be optimized maybe.
  // TODO: and actually sometimes it doesn't read twice, it does other things given
  // by restream because in some paths we have a file and others we have a stream.
  static attachFromFile(path) {
    return Blob.fromFile(path, 'text/csv')
      .then((blob) => ClientAudit.attach(blob, () => createReadStream(path)));
  }
  static attach(localBlob, restream) {
    return clientAudits.checkExisting(localBlob.sha)
      .then((existing) => {
        // now we know what's in the database; we have two optional operations that
        // we must stack together.
        const blobId = existing.blobId || localBlob.id;
        const createBlob = ((blobId == null) ? blobs.create(localBlob) : resolve(blobId));
        if (existing.parsedAudits === true) return createBlob;

        // the createBlob query is already running; we can in parallel parse the csv
        // and when we have the final blobId save all the information at once.
        return parseClientAudits(restream())
          .then((audits) => createBlob.then((savedBlobId) => {
            for (const audit of audits) audit.blobId = savedBlobId;
            return simply.insert('client_audits', audits)
              .then(always(savedBlobId));
          }));
      });
  }

  static streamForExport(formId) { return clientAudits.streamForExport(formId); }
});

