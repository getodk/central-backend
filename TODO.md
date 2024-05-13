* purge test:
  * one failed upload should not affect previous downloads
	* remove in-progress state and use row-lock?  this may handle killing upload process more gracefully
* move mocking to minio
* purge script should also remove stuff from s3
