* purge test:
  * one failed upload should not affect previous downloads
	* remove in-progress state and use row-lock?  this may handle killing upload process more gracefully
* move mocking to minio
