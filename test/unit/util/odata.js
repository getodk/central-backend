const { nextUrlFor } = require('../../../lib/util/odata');

describe('odata utils', () => {
  describe('nextUrlFor()', () => {
    [
      {
        originalUrl: '/v1/projects/1/datasets/people.svc/Entities?$top=1&$filter=__system/creatorId%20eq%206',
        remaining: 1,
        skipTokenData: { uuid: '92439171-ffa0-4f62-a9f6-ae37839ce4a7' },
        expected: '/v1/projects/1/datasets/people.svc/Entities?%24top=1&%24filter=__system%2FcreatorId+eq+6&%24skiptoken=01eyJ1dWlkIjoiOTI0MzkxNzEtZmZhMC00ZjYyLWE5ZjYtYWUzNzgzOWNlNGE3In0%3D',
      },

      {
        originalUrl: '/v1/projects/1/forms/double%20repeat.svc/Submissions(%27uuid%3A17b09e96-4141-43f5-9a70-611eb0e8f6b4%27)/children/child?$top=1',
        remaining: 2,
        skipTokenData: { repeatId: '7ac5f4d4facbaa9657c21ff221b885241c284b6c' },
        expected: '/v1/projects/1/forms/double%20repeat.svc/Submissions(%27uuid%3A17b09e96-4141-43f5-9a70-611eb0e8f6b4%27)/children/child?%24top=1&%24skiptoken=01eyJyZXBlYXRJZCI6IjdhYzVmNGQ0ZmFjYmFhOTY1N2MyMWZmMjIxYjg4NTI0MWMyODRiNmMifQ%3D%3D',
      },
      // Same as previous, but with different url encoding - request
      // URL-encoding is reflected in the response.
      {
        originalUrl: `/v1/projects/1/forms/double%20repeat.svc/Submissions('uuid:17b09e96-4141-43f5-9a70-611eb0e8f6b4')/children/child?$top=1`,
        remaining: 2,
        skipTokenData: { repeatId: '7ac5f4d4facbaa9657c21ff221b885241c284b6c' },
        expected: `/v1/projects/1/forms/double%20repeat.svc/Submissions('uuid:17b09e96-4141-43f5-9a70-611eb0e8f6b4')/children/child?%24top=1&%24skiptoken=01eyJyZXBlYXRJZCI6IjdhYzVmNGQ0ZmFjYmFhOTY1N2MyMWZmMjIxYjg4NTI0MWMyODRiNmMifQ%3D%3D`,
      },
    ].forEach(({ originalUrl, remaining, skipTokenData, expected }, idx) => {
      it(`should convert ${{ originalUrl, remaining, skipTokenData }} to ${expected} (#${idx})`, () => {
        nextUrlFor(remaining, originalUrl, skipTokenData).should.eql(expected);
      });
    });
  });
});

