const appRoot = require('app-root-path');
const { _init } = require(appRoot + '/lib/external/sentry');

describe('sentry', () => {
  it('should have expected integrations', () => {

    // Note, this test may break for the following reasons:
    //
    // * Sentry does not have a documented way to check the enabled integrations,
    //   so this test may break due to changing internals of the @sentry/node
    //   module.
    // * Sentry may change the default integrations.  In the case of new default
    //   integrations, consider if they should be added to the expected list
    //   below.  In the case of default integrations being removed, consider if
    //   they should be re-enabled manually.

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
});
