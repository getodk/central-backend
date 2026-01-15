const { testService } = require('../setup');
const { sql } = require('slonik');
const { instances } = require('../../data/xml');


describe('DB: Event stamping', () => {

  it('Event stamps are applied upon submission insertion and modification', testService(async (service, { db }) => {
    // As we are testing for the effect of a commit, we have to... commit. And then clean up.
    try {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .set('Content-Type', 'application/xml')
        .send(instances.simple.one)
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .set('Content-Type', 'application/xml')
        .send(instances.simple.two)
        .expect(200);

      await db.query(sql`commit;`);
      // .one and .two were created in the same transaction, but should receive the different event stamps (see https://github.com/getodk/central/issues/1609)
      (await db.oneFirst(sql`select array_agg(event order by event) from submissions`)).should.deepEqual([1, 2]);

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .set('Content-Type', 'application/xml')
        .send(instances.simple.three)
        .expect(200);

      await db.query(sql`commit;`);
      (await db.oneFirst(sql`select event from submissions where "instanceId" = 'three'`)).should.equal(3);

      await asAlice.put('/v1/projects/1/forms/simple/submissions/one')
        .set('Content-Type', 'application/xml')
        .send('<data id="simple"><meta><instanceID>oneA</instanceID><deprecatedID>one</deprecatedID></meta><whatevs>bla</whatevs></data>')
        .expect(200);

      await db.query(sql`commit;`);
      (await db.oneFirst(sql`select event from submissions where "instanceId" = 'one'`)).should.equal(4);

      await asAlice.patch('/v1/projects/1/forms/simple/submissions/one')
        .set('Content-Type', 'application/json')
        .send({ reviewState: 'approved' })
        .expect(200);

      await db.query(sql`commit;`);
      (await db.oneFirst(sql`select event from submissions where "instanceId" = 'one'`)).should.equal(5);

    } finally {
      await db.query(sql`truncate table submissions cascade`);
      await db.query(sql`truncate table audits cascade`);
      await db.query(sql`commit;`);
    }

  }));

});
