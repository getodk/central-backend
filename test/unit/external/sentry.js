const appRoot = require('app-root-path');
const { _init, filterXmlFormIdFromUrl } = require(appRoot + '/lib/external/sentry');

describe('sentry', () => {
  it('should have expected integrations', () => {

    // Note, this test may break for the following reasons:
    //
    // 1. Sentry does not have a documented way to check the enabled integrations,
    //    so this test may break due to changing internals of the @sentry/node
    //    module.  In this case, you will need to find a new way to check Sentry's
    //    enabled integrations, and update this test to use the new approach.
    //
    // 2. Sentry may change the default integrations.
    //
    //    In the case of new default integrations, consider if they are relevant.
    //
    //    * if yes: add them to the list of expected integrations below
    //    * if no:  disable them in lib/external/sentry.js
    //
    //    In the case of default integrations being removed, consider if they should
    //    be re-enabled manually.
    //
    //    * if yes: re-enable them in lib/external/sentry.js
    //    * if no:  remove them from the list below

    const config = {
      project: 1,
      key: 'abc-123',
      orgSubdomain: 'example',
    };

    const integrations = _init(config)
      .getClient()
      ._options
      .integrations
      .map(it => it.name)
      .sort();

    integrations.should.eql([
      'ChildProcess',
      'Connect',
      'Console',
      'Context',
      'ContextLines',
      'Dedupe',
      'Express',
      'FunctionToString',
      'GenericPool',
      'Http',
      'InboundFilters',
      'LinkedErrors',
      'LocalVariablesAsync',
      'LruMemoizer',
      'Modules',
      'NodeFetch',
      'OnUncaughtException',
      'OnUnhandledRejection',
      'Postgres',
      'ProcessSession',
      'RequestData',
      'Tedious',
    ]);
  });

  /* eslint-disable no-multi-spaces */
  describe('filterXmlFormIdFromUrl()', () => {
    [
      [ '/projects/:projectId/forms/:xmlFormId', '/projects/1/forms/1',  '/projects/1/forms/:xmlFormId' ],
      [ '/projects/:projectId/forms/:xmlFormId', '/projects/11/forms/1', '/projects/11/forms/:xmlFormId' ],

      [ '/projects/:projectId/forms/:xmlFormId', '/projects/1/forms/11',  '/projects/1/forms/:xmlFormId' ],
      [ '/projects/:projectId/forms/:xmlFormId', '/projects/11/forms/11', '/projects/11/forms/:xmlFormId' ],

      [ '/projects/:projectId/forms/:xmlFormId', '/projects/1/forms/form_name',  '/projects/1/forms/:xmlFormId' ],
      [ '/projects/:projectId/forms/:xmlFormId', '/projects/11/forms/form_name', '/projects/11/forms/:xmlFormId' ],

      [ '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/1.svc',  '/projects/1/forms/:xmlFormId.svc' ],
      [ '/projects/:projectId/forms/:xmlFormId.svc', '/projects/11/forms/1.svc', '/projects/11/forms/:xmlFormId.svc' ],

      [ '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/11.svc',  '/projects/1/forms/:xmlFormId.svc' ],
      [ '/projects/:projectId/forms/:xmlFormId.svc', '/projects/11/forms/11.svc', '/projects/11/forms/:xmlFormId.svc' ],

      [ '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/form_name.svc',  '/projects/1/forms/:xmlFormId.svc' ],
      [ '/projects/:projectId/forms/:xmlFormId.svc', '/projects/11/forms/form_name.svc', '/projects/11/forms/:xmlFormId.svc' ],

      [ '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/1/forms/1/more-path',  '/projects/1/forms/:xmlFormId/more-path' ],
      [ '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/11/forms/1/more-path', '/projects/11/forms/:xmlFormId/more-path' ],

      [ '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/1/forms/11/more-path',  '/projects/1/forms/:xmlFormId/more-path' ],
      [ '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/11/forms/11/more-path', '/projects/11/forms/:xmlFormId/more-path' ],

      [ '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/1/forms/form_name/more-path',  '/projects/1/forms/:xmlFormId/more-path' ],
      [ '/projects/:projectId/forms/:xmlFormId/more-path', '/projects/11/forms/form_name/more-path', '/projects/11/forms/:xmlFormId/more-path' ],

      [ '/projects/:projectId/forms/:xmlFormId.svc/more-path', '/projects/1/forms/1.svc/more-path',  '/projects/1/forms/:xmlFormId.svc/more-path' ],
      [ '/projects/:projectId/forms/:xmlFormId.svc/more-path', '/projects/11/forms/1.svc/more-path', '/projects/11/forms/:xmlFormId.svc/more-path' ],

      [ '/projects/:projectId/forms/:xmlFormId.svc/more-path', '/projects/1/forms/11.svc/more-path',  '/projects/1/forms/:xmlFormId.svc/more-path' ],
      [ '/projects/:projectId/forms/:xmlFormId.svc/more-path', '/projects/11/forms/11.svc/more-path', '/projects/11/forms/:xmlFormId.svc/more-path' ],

      [ '/projects/:projectId/forms/:xmlFormId.svc/more-path', '/projects/1/forms/form_name.svc/more-path',  '/projects/1/forms/:xmlFormId.svc/more-path' ],
      [ '/projects/:projectId/forms/:xmlFormId.svc/more-path', '/projects/11/forms/form_name.svc/more-path', '/projects/11/forms/:xmlFormId.svc/more-path' ],

      // alternate file extensions
      [ '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/1.xls',  '/projects/1/forms/:xmlFormId.xls' ],
      [ '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/1.xlsx', '/projects/1/forms/:xmlFormId.xlsx' ],
      [ '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/1.7z',   '/projects/1/forms/:xmlFormId.7z' ],
      [ '/projects/:projectId/forms/:xmlFormId.svc', '/projects/1/forms/1.xyz',  '/projects/1/forms/:xmlFormId.xyz' ],
    ].forEach(([ transaction, originalUrl, expectedUrl ]) => {
      it(`should convert ${originalUrl} to ${expectedUrl}`, () => {
        filterXmlFormIdFromUrl(transaction, originalUrl).should.eql(expectedUrl);
      });
    });
  });
  /* eslint-enable no-multi-spaces */
});
