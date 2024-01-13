// FIXME rename this file to ci-s3-setup or ci-create-minio-bucket or something
const Minio = require('minio');

const minioClient = (() => {
  return new Minio.Client({
    endPoint: 'http://localhost',
    port: 9000,
    useSSL: false,
    accessKey: 'odk-central-dev',
    secretKey: 'topSecret123',
  });
})();

const { bucketName } = require('config').get('default.s3blobStore');

minioClient.makeBucket(bucketName, { ObjectLocking:true });


// TODO create normal user?
// TODO create bucket?
// TODO create policy?
   /*
	 docker run -v "${PWD}/s3-dev/minio-config/:/root/.mc/" --network=host minio/mc admin user add local odk-central-dev topSecret123 && \
	 docker run -v "${PWD}/s3-dev/minio-config/:/root/.mc/" --network=host minio/mc mb --ignore-existing local/odk-central-bucket && \
	(docker run -v "${PWD}/s3-dev/minio-config/:/root/.mc/" --network=host minio/mc admin policy attach local readwrite --user odk-central-dev || true) && \
  */
