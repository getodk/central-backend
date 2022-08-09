const { testService } = require('../setup');
const testData = require('../../data/xml');

describe('api: /submissions/:id/comments', () => {
  describe('POST', () => {
    it('should reject notfound if the submission does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions/nonexistent/comments')
          .send({ body: 'test test' })
          .expect(404))));

    it('should reject if the user cannot read the submission', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.post('/v1/projects/1/forms/simple/submissions/one/comments')
              .send({ body: 'test test' })
              .expect(403))))));

    it('should reject if no comment is provided', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions/one/comments')
            .expect(400)))));

    it('should accept the new comment', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions/one/comments')
            .send({ body: 'new comment here' })
            .expect(200))
          .then(({ body }) => {
            body.should.be.a.Comment();
            body.body.should.equal('new comment here');
          })
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/comments')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(1);
              body[0].should.be.a.Comment();
              body[0].actorId.should.equal(5);
              body[0].createdAt.should.be.a.recentIsoDate();
              body[0].body.should.equal('new comment here');
            })))));
  });

  describe('GET', () => {
    it('should reject notfound if the submission does not exist', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions/nonexistent/comments')
          .send({ body: 'test test' })
          .expect(404))));

    it('should reject if the user cannot read the submission', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .then(() => service.login('chelsea', (asChelsea) =>
            asChelsea.get('/v1/projects/1/forms/simple/submissions/one/comments')
              .expect(403))))));

    it('should return comments in order', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions/one/comments')
            .send({ body: 'new comment here' })
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions/one/comments')
            .send({ body: 'second comment here' })
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/comments')
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(2);
              body.map((comment) => comment.body)
                .should.eql([ 'second comment here', 'new comment here' ]);
            })))));

    it('should return extended comments', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions/one/comments')
            .send({ body: 'new comment here' })
            .expect(200))
          .then(() => service.login('bob', (asBob) =>
            asBob.post('/v1/projects/1/forms/simple/submissions/one/comments')
              .send({ body: 'second comment here' })
              .expect(200)))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/one/comments')
            .set('X-Extended-Metadata', true)
            .expect(200)
            .then(({ body }) => {
              body.length.should.equal(2);
              body[0].actor.should.be.an.Actor();
              body[1].actor.should.be.an.Actor();
              body.map((comment) => comment.actor.displayName)
                .should.eql([ 'Bob', 'Alice' ]);
            })))));
  });
});

