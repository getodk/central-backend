const appRoot = require('app-root-path');
const { init } = require(appRoot + '/lib/external/sentry');

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

    const integrations = init(config)
      .getClient()
      ._options
      .integrations
      .map(it => it.name)
      .sort();

    integrations.should.eql([
      'Amqplib',
      'ChildProcess',
      'Connect',
      'Console',
      'Context',
      'ContextLines',
      'Express',
      'Fastify',
      'FunctionToString',
      'GenericPool',
      'Graphql',
      'Hapi',
      'Http',
      'InboundFilters',
      'Kafka',
      'Koa',
      'LinkedErrors',
      'LocalVariablesAsync',
      'LruMemoizer',
      'Modules',
      'Mongo',
      'Mongoose',
      'Mysql',
      'Mysql2',
      'NodeFetch',
      'OnUncaughtException',
      'OnUnhandledRejection',
      'Postgres',
      'Prisma',
      'ProcessSession',
      'Redis',
      'RequestData',
      'Tedious',
      'VercelAI',
    ]);
  });
});
