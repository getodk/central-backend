const Minio = require('minio');

// TODO create normal user?
// TODO create bucket?
// TODO create policy?
   /*
	 docker run -v "${PWD}/s3-dev/minio-config/:/root/.mc/" --network=host minio/mc admin user add local odk-central-dev topSecret123 && \
	 docker run -v "${PWD}/s3-dev/minio-config/:/root/.mc/" --network=host minio/mc mb --ignore-existing local/odk-central-bucket && \
	(docker run -v "${PWD}/s3-dev/minio-config/:/root/.mc/" --network=host minio/mc admin policy attach local readwrite --user odk-central-dev || true) && \
  */
