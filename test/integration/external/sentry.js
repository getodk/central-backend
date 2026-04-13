const assert = require('node:assert/strict');
const { execSync, spawn } = require('node:child_process');

const express = require('express');
const { v4:uuid } = require('uuid');

describe.only('sentry', () => {
  describe('task integration', () => {
    let server, port;

    beforeEach(() => new Promise((resolve, reject) => {
      const events = [];

      const app = express();
      //app.use(express.json());
      app.use(express.text({ type:() => true, limit:'5mb' }));
      app.use((req, res, next) => {
        const { method, path, headers, query, params, body } = req;
        next();
      });
      app.get('/event-log', (req, res) => {
        res.send(events);
      });
      app.all('/*', (req, res) => {
        const parts = req.body.split('\n').filter(it => it).map(it => JSON.parse(it));
        if(parts.length !== 3) throw new Error(`unrecognised part count: ${parts.length}`);

        const [ metadata, typeContainer, data ] = parts;

        const { type } = typeContainer;
        if(!type) throw new Error('No type property found in typeContainer.');

        if(type === 'event') events.push({ metadata, data });

        res.send({ id:uuid().replace(/-/g, '') });
      });

      server = app.listen(0, () => {
        port = server.address().port;
        resolve();
      });

      server.on('error', reject);
    }));
    afterEach(() => {
      server?.close();
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
                tunnel: `http://localhost:${port}/dsn`,
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
      const res = await fetch(`http://localhost:${port}/event-log`);
      assert.equal(res.status, 200);
      return await res.json();
    }
  });

  function sleep(ms) { // eslint-disable-line no-use-before-define
    return new Promise(resolve => setTimeout(resolve, ms));
  }
});
