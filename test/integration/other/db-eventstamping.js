const { testService } = require('../setup');
const { sql } = require('slonik');
const { instances } = require('../../data/xml');
const { URL } = require('url');


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


describe('DB: Etag for filter/pagination', () => {

  it('Etags change when submission selections change', testService(async (service, { db, Submissions }) => {
    // As we are testing for the effect of a commit, we have to... commit. And then clean up.
    try {
      const asAlice = await service.login('alice');

      let lastEtag = await Submissions.getSelectionEtag(1, false);

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .set('Content-Type', 'application/xml')
        .send(instances.simple.one)
        .expect(200);

      await db.query(sql`commit;`);
      let etagForOne = await Submissions.getSelectionEtag(1, false);

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .set('Content-Type', 'application/xml')
        .send(instances.simple.two)
        .expect(200);

      await db.query(sql`commit;`);
      await Submissions.getSelectionEtag(1, false).then(etag => { etag.should.not.equal(lastEtag); lastEtag = etag; });

      await asAlice.post('/v1/projects/1/forms/simple/submissions')
        .set('Content-Type', 'application/xml')
        .send(instances.simple.three)
        .expect(200);

      await db.query(sql`commit;`);
      // in the default ordering, that last submission was inserted at the top, acquire the previous selection using offset and limit
      await Submissions.getSelectionEtag(1, false, null, 2, 1).then(etag => etag.should.equal(lastEtag));
      // check whether limit parameter works to select just the first submission
      await Submissions.getSelectionEtag(1, false, null, 1, 2).then(etag => etag.should.equal(etagForOne));
      // check whether odata filter works to select just the first submission
      await Submissions.getSelectionEtag(1, false, `__id eq 'one'`).then(etag => etag.should.equal(etagForOne));
      // check whether the whole collection's etag changed
      await Submissions.getSelectionEtag(1, false).then(etag => { etag.should.not.equal(lastEtag); lastEtag = etag; });

      // check whether modification results in changed etag
      await asAlice.put('/v1/projects/1/forms/simple/submissions/one')
        .set('Content-Type', 'application/xml')
        .send('<data id="simple"><meta><instanceID>oneA</instanceID><deprecatedID>one</deprecatedID></meta><whatevs>bla</whatevs></data>')
        .expect(200);

      await db.query(sql`commit;`);
      // check whether etag for selection with first submission changed when its contents have changed
      await Submissions.getSelectionEtag(1, false, `__id eq 'one'`).then(etag => { etag.should.not.equal(etagForOne); etagForOne = etag; });

      await asAlice.patch('/v1/projects/1/forms/simple/submissions/one')
        .set('Content-Type', 'application/json')
        .send({ reviewState: 'approved' })
        .expect(200);

      await db.query(sql`commit;`);
      // check whether etag for selection with first submission changed when its metadata is changed
      await Submissions.getSelectionEtag(1, false, `__id eq 'one'`).then(etag => { etag.should.not.equal(etagForOne); etagForOne = etag; });
      // check whether orderBy + paging works for getting at the same selection
      await Submissions.getSelectionEtag(1, false, null, 1, 0, '__system/submissionDate ASC').then(etag => etag.should.equal(etagForOne));
      await Submissions.getSelectionEtag(1, false, null, 1, 0, '__system/submissionDate DESC').then(etag => etag.should.not.equal(etagForOne));

      // get an odata-style skiptoken to get an URL for a selection with the etag for the first submission, check the HTTP etag header
      await asAlice.get('/v1/projects/1/forms/simple.svc/Submissions?$skip=1&$top=1') // this skips submission "three" and gets submission "two", nextLink will be for submission "one"
        .set('Accept', 'application/json')
        .expect(200)
        .then(({ body }) => new URL(body['@odata.nextLink']))
        .then(oDataSkiptokenedUrl =>
          asAlice.get(oDataSkiptokenedUrl.pathname + oDataSkiptokenedUrl.search)
            .set('Accept', 'application/json')
            .expect(200)
            .then(({ header }) => header.etag.should.equal(`W/"${etagForOne}"`))
        );

    } finally {
      await db.query(sql`truncate table submissions cascade`);
      await db.query(sql`truncate table audits cascade`);
      await db.query(sql`commit;`);
    }

  }));
});
