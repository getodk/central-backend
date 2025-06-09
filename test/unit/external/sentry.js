const appRoot = require('app-root-path');
const { filterXmlFormIdFromUrl } = require(appRoot + '/lib/external/sentry');

describe.only('external/sentry', () => {
  describe('filterXmlFormIdFromUrl()', () => {
    [
      [ '/forms/:id/restore', '/forms/1/restore',  '/forms/1/restore' ],
      [ '/forms/:id/restore', '/forms/11/restore', '/forms/11/restore' ],

      [ '/projects/:projectId/forms/:xmlFormId', '/projects/1/forms/1',  '/projects/1/forms/:xmlFormId' ],
      [ '/projects/:projectId/forms/:xmlFormId', '/projects/1/forms/1',  '/projects/1/forms/:xmlFormId' ],

      [ '/projects/:projectId/forms/:xmlFormId', '/projects/1/forms/11',  '/projects/1/forms/:xmlFormId' ],
      [ '/projects/:projectId/forms/:xmlFormId', '/projects/1/forms/11',  '/projects/1/forms/:xmlFormId' ],

      [ '/projects/:projectId/forms/:xmlFormId', '/projects/1/forms/form_name',  '/projects/1/forms/:xmlFormId' ],
      [ '/projects/:projectId/forms/:xmlFormId', '/projects/1/forms/form_name',  '/projects/1/forms/:xmlFormId' ],

      [ '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/1.svc',  '/projects/1/forms/:xmlFormId.svc' ],
      [ '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/1.svc',  '/projects/1/forms/:xmlFormId.svc' ],

      [ '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/11.svc',  '/projects/1/forms/:xmlFormId.svc' ],
      [ '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/11.svc',  '/projects/1/forms/:xmlFormId.svc' ],

      [ '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/form_name.svc',  '/projects/1/forms/:xmlFormId.svc' ],
      [ '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/form_name.svc',  '/projects/1/forms/:xmlFormId.svc' ],

      [ '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/1/forms/1/more-path',  '/projects/1/forms/:xmlFormId/more-path' ],
      [ '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/1/forms/1/more-path',  '/projects/1/forms/:xmlFormId/more-path' ],

      [ '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/1/forms/11/more-path',  '/projects/1/forms/:xmlFormId/more-path' ],
      [ '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/1/forms/11/more-path',  '/projects/1/forms/:xmlFormId/more-path' ],

      [ '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/1/forms/form_name/more-path',  '/projects/1/forms/:xmlFormId/more-path' ],
      [ '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/1/forms/form_name/more-path',  '/projects/1/forms/:xmlFormId/more-path' ],

      [ '/projects/:projectId/forms/:xmlFormId.svc/more-path', '/projects/1/forms/1.svc/more-path',  '/projects/1/forms/:xmlFormId.svc/more-path' ],
      [ '/projects/:projectId/forms/:xmlFormId.svc/more-path', '/projects/1/forms/1.svc/more-path',  '/projects/1/forms/:xmlFormId.svc/more-path' ],

      [ '/projects/:projectId/forms/:xmlFormId.svc/more-path', '/projects/1/forms/11.svc/more-path',  '/projects/1/forms/:xmlFormId.svc/more-path' ],
      [ '/projects/:projectId/forms/:xmlFormId.svc/more-path', '/projects/1/forms/11.svc/more-path',  '/projects/1/forms/:xmlFormId.svc/more-path' ],

      [ '/projects/:projectId/forms/:xmlFormId.svc/more-path', '/projects/1/forms/form_name.svc/more-path',  '/projects/1/forms/:xmlFormId.svc/more-path' ],
      [ '/projects/:projectId/forms/:xmlFormId.svc/more-path', '/projects/1/forms/form_name.svc/more-path',  '/projects/1/forms/:xmlFormId.svc/more-path' ],
    ].forEach(([ transaction, originalUrl, expectedUrl ]) => {
      it(`should convert ${originalUrl} to ${expectedUrl}`, () => {
        filterXmlFormIdFromUrl(transaction, originalUrl).should.eql(expectedUrl);
      });
    });
  });
});
