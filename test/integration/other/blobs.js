const { createReadStream, readFileSync } = require('fs');
const appPath = require('app-root-path');
const { sql } = require('slonik');
const { testService } = require('../setup');

describe('blob query module', () => {
  it('should not try to purge blobs that are still referenced', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(readFileSync(appPath + '/test/data/simple.xlsx'))
        .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .expect(200)
        .then(() => container.Blobs.purgeUnattached())
        .then(() => container.oneFirst(sql`select count(*) from blobs`))
        .then((count) => count.should.equal(1)))));
});
