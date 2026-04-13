const assert = require('node:assert/strict');
const { execSync, spawn } = require('node:child_process');

const express = require('express');
const { v4:uuid } = require('uuid');

describe.only('sentry', () => {
  describe('task integration', () => {
    let mockSentry;
    beforeEach(async () => {
      mockSentry = await initMockSentry();
    });
    afterEach(() => {
      mockSentry?.close();
    });

    it('should include odk-task tag in error event', async function() {
      // given
      const env = {
        ...process.env, // ensure NodeJS is available in child process
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
      const child = spawn('node', ['lib/bin/test-sentry-logging', 'test error'], { env });
      await new Promise(resolve => child.on('close', resolve));
      // and
      await sleep(100);

      // then
      const loggedEvents = await getLoggedEvents();
      assert.equal(loggedEvents.length, 1);
      const [ e ] = loggedEvents;
      assert.deepEqual(e.data.tags, { 'odk-task':'test-sentry-logging' });
    });

    async function getLoggedEvents() { // eslint-disable-line no-use-before-define
      const res = await fetch(`${mockSentry.baseUrl()}/event-log`);
      assert.equal(res.status, 200);
      return await res.json();
    }
  });

  function sleep(ms) { // eslint-disable-line no-use-before-define
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function initMockSentry() { // eslint-disable-line no-use-before-define
    const server = await new Promise((resolve, reject) => {
      const events = [];

      const app = express();
      app.use(express.text({ type:() => true, limit:'5mb' }));
      app.get('/event-log', (req, res) => {
        res.send(events);
      });
      app.post('/sentry-tunnel', (req, res) => {
        const parts = req.body.split('\n').filter(it => it).map(it => JSON.parse(it));
        if(parts.length !== 3) throw new Error(`unrecognised part count: ${parts.length}`);

        const [ metadata, typeContainer, data ] = parts;

        const { type } = typeContainer;
        if(!type) throw new Error('No type property found in typeContainer.');

        if(type === 'event') events.push({ metadata, data });

        res.send({ id:uuid().replace(/-/g, '') });
      });

      const server = app.listen(0, () => {
        resolve(server);
      });

      server.on('error', reject);
    });

    return {
      close: server.close.bind(server),
      baseUrl: () => `http://localhost:${server.address().port}`,
    };
  }
});
