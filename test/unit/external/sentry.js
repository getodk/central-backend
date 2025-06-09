describe.only('external/sentry', () => {
  describe('filterXmlFormIdFromUrl()', () => {
    [
      '/forms/:id/restore', '/forms/1/restore',  '/forms/1/restore',
      '/forms/:id/restore', '/forms/11/restore', '/forms/11/restore',

      '/projects/:projectId/forms/:xmlFormId', '/projects/1/forms/1',  '/projects/1/forms/:xmlFormId',
      '/projects/:projectId/forms/:xmlFormId', '/projects/1/forms/1',  '/projects/1/forms/:xmlFormId',

      '/projects/:projectId/forms/:xmlFormId', '/projects/1/forms/11',  '/projects/1/forms/:xmlFormId',
      '/projects/:projectId/forms/:xmlFormId', '/projects/1/forms/11',  '/projects/1/forms/:xmlFormId',

      '/projects/:projectId/forms/:xmlFormId', '/projects/1/forms/form_name',  '/projects/1/forms/:xmlFormId',
      '/projects/:projectId/forms/:xmlFormId', '/projects/1/forms/form_name',  '/projects/1/forms/:xmlFormId',

      '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/1.svc',  '/projects/1/forms/:xmlFormId',
      '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/1.svc',  '/projects/1/forms/:xmlFormId',

      '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/11.svc',  '/projects/1/forms/:xmlFormId',
      '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/11.svc',  '/projects/1/forms/:xmlFormId',

      '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/form_name.svc',  '/projects/1/forms/:xmlFormId',
      '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/form_name.svc',  '/projects/1/forms/:xmlFormId',

      '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/1/forms/1/more-path',  '/projects/1/forms/:xmlFormId/more-path',
      '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/1/forms/1/more-path',  '/projects/1/forms/:xmlFormId/more-path',

      '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/1/forms/11/more-path',  '/projects/1/forms/:xmlFormId/more-path',
      '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/1/forms/11/more-path',  '/projects/1/forms/:xmlFormId/more-path',

      '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/1/forms/form_name/more-path',  '/projects/1/forms/:xmlFormId/more-path',
      '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/1/forms/form_name/more-path',  '/projects/1/forms/:xmlFormId/more-path',
    ].forEach(([ transaction, originalUrl, expectedUrl ]) => {
      it(`should convert ${originalUrl} to ${expectedUrl}`, () => {
        assert.equal(filterXmlFormIdFromUrl(transaction, originalUrl, expectedUrl));
      });
    });
  });
