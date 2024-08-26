## TODO

* purge tests
* document trade-off of long transactions vs less-atomic uploads
  * this is great for data integrity - automatic rollback to pending, and nothing can get stuck in in-progress
  * this does introduce risk that database connections for long-running uploads could be interrupted, and this would not be discovered until the upload was complete.  this scenario seems unlikely as (1) server-to-database connection is probably quite reliable, and (2) uploads are rarely likely to be so big that the upload takes ages.
* resolve all FIXMEs introduced in this PR
* review all TODOs introduced in this PR
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
