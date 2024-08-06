## TODO

* remove in-progress state and use row-lock?  this may handle killing upload process more gracefully; see processSubmissionEvent() in lib/model/query/entities.js for an example
* make sure that a failed/killed process can't result in a blob stuck as "uploading", or if that is possible then there is a way to clean that up from the CLI.  currently this _is_ possible, so there should be a mechanism to reset.  obvious options:
  * reset all at startup
  * reset all via CLI script (e.g. `UPDATE blobs SET s3_status='failed' WHERE id IN (SELECT id FROM blobs WHERE s3_status='in_progress' FOR NO KEY UPDATE SKIP LOCKED);`)
* check what happens with S3 when trying to re-upload identical content - https://groups.google.com/g/jets3t-users/c/i1gusIu5mTw
* remove this file

## Central repo

* add env var -> config mapping
* add cron job for triggering upload? central:files/service/crontab

## Queries

* consider NOT deleting blob.content on upload - instead add CLI script to EXPLICITLY delete all uploaded blobs
* if e.g. 1 blob is missing from s3, and user is trying to export large amount of data, how should we handle?
  * simpler: just fail completely
  * more helpful: e.g. inline error message in exported data... but if done badly this could be misleading and the user may never notice that they've got a partial export
* logging events? upload succeed, upload failed etc.?
* What should be documented about setting up S3?
  * Minimal recommended setup of S3
  * S3 retention strategy? Stop things from being deleted manually from S3?
  * CLI usage
* Should upload-blobs cli be part automatically part of cron job or should it be fully under admin's control? Manual control (e.g. running upload script or adding to a cron job themselves) can allow uploading to take place during a service window or using a custom schedule appropriate to specific blob usage.


## For review

1. test scope
2. test content
3. app code

## Future considerations?

* do we need to support migrating back?
