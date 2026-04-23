const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const express = require('express');
const { v4: uuid } = require('uuid');

const { sleep } = require('../../util/util');

describe('sentry', () => {
  describe('task integration', () => {
    let mockSentry;
    beforeEach(async () => {
      mockSentry = await initMockSentry(); // eslint-disable-line no-use-before-define
    });
    afterEach(() => {
      mockSentry?.close();
    });

    it('should include odk-task tag in error event', async () => {
      // given
      const env = {
        ...process.env, // ensure NodeJS is available to child process
        NODE_CONFIG: JSON.stringify({
          default: {
            external: {
              sentry: {
                key: 'deadbeefcafe',
                orgSubdomain: 'o123',
                project: 123,
                tunnel: `${mockSentry.baseUrl()}/sentry-tunnel`,
              },
            },
          },
        }),
      };

      // when
      const child = spawn('node', ['test/bin/test-sentry-logging', 'test error'], { env });
      await new Promise(resolve => child.on('close', resolve)); // eslint-disable-line no-promise-executor-return
      // and
      await sleep(100); // eslint-disable-line no-use-before-define

      // then
      const loggedEvents = await getLoggedEvents(); // eslint-disable-line no-use-before-define
      assert.deepEqual(
        loggedEvents.map(e => e.data.tags),
        [ { 'odk-task': 'test-sentry-logging' } ],
      );
    });

    async function getLoggedEvents() { // eslint-disable-line no-use-before-define
      const res = await fetch(`${mockSentry.baseUrl()}/event-log`);
      assert.equal(res.status, 200);
      return res.json();
    }
  });

  async function initMockSentry() { // eslint-disable-line no-use-before-define
    const server = await new Promise((resolve, reject) => {
      const events = [];

      const app = express();
      app.use(express.text({ type: () => true }));
      app.get('/event-log', (req, res) => {
        res.send(events);
      });
      app.post('/sentry-tunnel', (req, res) => {
        const parts = req.body.split('\n').filter(it => it).map(it => JSON.parse(it));
        if (parts.length !== 3) throw new Error(`Unrecognised part count: ${parts.length}`);

        const [ metadata, typeContainer, data ] = parts;

        const { type } = typeContainer;
        if (!type) throw new Error('No type property found in typeContainer.');

        if (type === 'event') events.push({ metadata, data });

        res.send({ id: uuid().replace(/-/g, '') });
      });

      const _server = app.listen(0, () => {
        resolve(_server);
      });
      _server.on('error', reject);
    });

    return {
      close: server.close.bind(server),
      baseUrl: () => `http://localhost:${server.address().port}`,
    };
  }
});
