const { contentDisposition, redirect, withEtag } = require('./http');
const s3 = require('./s3');

const binary = (type, name, content) => (_, response) => {
  response.set('Content-Disposition', contentDisposition(name));
  response.set('Content-Type', type);
  return content;
};

module.exports = function blobResponse(filename, blob) {
  if (blob.s3_status === 'uploaded') {
    return withEtag(
      blob.md5,
      async () => redirect(307, await s3.urlForBlob(filename, blob)),
      false,
    );
  } else {
    return withEtag(
      blob.md5,
      () => binary(blob.contentType, filename, blob.content),
    );
  }
};
