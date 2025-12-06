const assert = require('node:assert/strict');

const appRoot = require('app-root-path');
const { _init, filterXmlFormIdFromUrl } = require(appRoot + '/lib/external/sentry');

describe('sentry', () => {
  it('should have expected Integrations', () => {
    const getIntegrations = () => {
      try {
        const config = {
          project: 1,
          key: 'abc-123',
          orgSubdomain: 'example',
        };

        return _init(config)
          .getClient()
          ._options
          .integrations
          .map(it => it.name)
          .sort();
      } catch (err) {
        assert.fail(`

          Fetching Sentry Integrations failed with error:

              ${err}

          Sentry does not have a documented way to check the enabled
          Integrations, so this test may have broken due to changing
          internals of the @sentry/node module.

          Find a new way to check Sentry's enabled Integrations, and
          update this test to use the new approach.
        `);
      }
    };

    const integrations = getIntegrations();

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
    ], `

       There's been a change in Sentry's default Integrations.

       If a listed integration's been removed, consider if it should
       be re-enabled manually.

       If there's a new integration which isn't explicitly expected
       in this test, consider if it's useful to this codebase.

       To enable or disable Integrations, see:

           lib/external/sentry.js

       For a full list of available Integrations, see:

           https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/
    `);
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
