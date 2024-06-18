## TODO

* remove in-progress state and use row-lock?  this may handle killing upload process more gracefully
* logging events? upload succeed, upload failed etc.?
* make sure that a failed/killed process can't result in a blob stuck as "uploading", or if that is possible then there is a way to clean that up from the CLI
* check what happens with S3 when trying to re-upload identical content - https://groups.google.com/g/jets3t-users/c/i1gusIu5mTw
* consider NOT deleting blob.content on upload - instead add CLI script to EXPLICITLY delete all uploaded blobs
* if e.g. 1 blob is missing from s3, and user is trying to export large amount of data, how should we handle?
  * simpler: just fail completely
  * more helpful: e.g. inline error message in exported data... but if done badly this could be misleading and the user may never notice that they've got a partial export
* remove this file

## For review:

1. test scope
2. test content
3. app code

## Future considerations?

* do we need to support migrating back?
