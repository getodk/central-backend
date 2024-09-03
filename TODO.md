## TODO

* IN THE CODE: document trade-off of long transactions vs less-atomic uploads
  * this is great for data integrity - automatic rollback to pending, and nothing can get stuck in in-progress
  * this does introduce risk that database connections for long-running uploads could be interrupted, and this would not be discovered until the upload was complete.  this scenario seems unlikely as (1) server-to-database connection is probably quite reliable, and (2) uploads are rarely likely to be so big that the upload takes ages.
* resolve all FIXMEs introduced in this PR
* review all TODOs introduced in this PR
* remove this file

## Central repo

* add env var -> config mapping
* add cron job for triggering upload? central:files/service/crontab
