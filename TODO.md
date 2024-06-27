## TODO

* remove in-progress state and use row-lock?  this may handle killing upload process more gracefully; see processSubmissionEvent() in lib/model/query/entities.js for an example
* make sure that a failed/killed process can't result in a blob stuck as "uploading", or if that is possible then there is a way to clean that up from the CLI
* check what happens with S3 when trying to re-upload identical content - https://groups.google.com/g/jets3t-users/c/i1gusIu5mTw
* e2e test is currently not very interesting - could the upload-pending CLI call be async, and we test what happens if we try to fetch attachments while upload is in progress?
* e2e: add a test for e.g. uploading 50/100 blobs and then killing tthe job - make sure the 50 are marked as uploaded!
* resolve TODO in lib/task/s3
* add test for uploadFromBlob() when md5/file content do no match?
* remove this file

## Central repo

* add env var -> config mapping
* add cron job for triggering upload?

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

## For review

1. test scope
2. test content
3. app code

## Future considerations?

* do we need to support migrating back?
