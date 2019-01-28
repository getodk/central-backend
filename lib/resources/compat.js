// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { redirect } = require('../util/http');
const { createReadStream } = require('fs');
const { always } = require('ramda');
const { createdMessage } = require('../outbound/openrosa');
const { getOrNotFound, getOrReject, rejectIf, reject, resolve, ignoringResult } = require('../util/promise');
const Option = require('../util/option');
const Problem = require('../util/problem');

// COPYPASTED multipart things:
const multer = require('multer');
const tmpdir = require('tmp').dirSync();
const multipart = multer({ dest: tmpdir.name });

const legacyName = 'Forms you made before projects existed';

// we are guaranteed to be authenticating with a session below, since these
// endpoints are only ever hit by app users. everybody else: get outta here!

module.exports = (service, endpoint) => {
  service.get('/formList', endpoint(({ Project }, { auth }) =>
    Project.getAll().then((projects) => {
      const legacyProject = projects.find((project) => project.name === legacyName);
      return (legacyProject == null)
        ? Problem.user.notFound()
        : redirect(302, `/v1/key/${auth.session().get().token}/projects/${legacyProject.id}/formList`);
    })));

  // TEMP TEMP TEMP: COPYPASTA FROM submissions.js => POST /projcets/:id/submission
  // ANY CHANGES THERE SHOULD GO HERE
  service.post('/submission', multipart.any(), endpoint.openRosa(({ Audit, Project, Submission }, { files, auth, query }) =>
    Project.getAll().then((projects) => {
      const project = projects.find((p) => p.name === legacyName);
      if (project == null) return Problem.user.notFound();

      return auth.canOrReject('submission.create', project)
        // then locate the actual xml and parse it into a partial submission.
        .then(() => Option.of(files).map((xs) => xs.find((file) => file.fieldname === 'xml_submission_file')))
        .then(getOrReject(Problem.user.missingMultipartField({ field: 'xml_submission_file' })))
        .then((file) => Submission.fromXml(createReadStream(file.path)))
        // now that we know the target form, fetch it and make sure it's accepting submissions.
        .then((partial) => project.getFormByXmlFormId(partial.xmlFormId)
          .then(getOrNotFound) // TODO: detail why
          .then(rejectIf(
            (form) => !form.acceptsSubmissions(),
            always(Problem.user.notAcceptingSubmissions())
          ))
          .then((form) => Submission.getById(form.id, partial.instanceId)
            // we branch based on whether a submission already existed; in either case, we exit this
            // branching promise path with a Promise[Submission] that is complete (eg with an id).
            .then((maybeExtant) => maybeExtant
              // if a submission already exists, first verify that the posted xml still matches
              // (if it does not, reject). then, attach any new posted files.
              .map((extant) => ((Buffer.compare(Buffer.from(extant.xml), Buffer.from(partial.xml)) !== 0)
                ? reject(Problem.user.xmlConflict())
                : resolve(extant).then(ignoringResult((submission) => submission.addAttachments(files)))))
              // otherwise, this is the first POST for this submission. create the
              // submission and the expected attachments:
              .orElseGet(() => partial.complete(form, auth.actor(), query.deviceID).create()
                .then(ignoringResult((submission) => submission.createExpectedAttachments(form, files)))))
            // now we have a definite submission; we just need to do audit logging.
            .then((submission) => Audit.log(auth.actor(), 'submission.create', form, { submissionId: submission.id }))
            // TODO: perhaps actually decide between "full" and "partial"; aggregate does this.
            .then(always(createdMessage({ message: 'full submission upload was successful!' })))));
    })));
};

