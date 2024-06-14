## TODO

* remove in-progress state and use row-lock?  this may handle killing upload process more gracefully
* logging events? upload succeed, upload failed etc.?
* make sure that a failed/killed process can't result in a blob stuck as "uploading", or if that is possible then there is a way to clean that up from the CLI
* remove this file

## For review:

1. test scope
2. test content
3. app code

## Future considerations?

* do we need to support migrating back?
