const appRoot = require('app-root-path');
const { sql } = require('slonik');
const { testTask } = require('../setup');
const { reapSessions } = require(appRoot + '/lib/task/reap-sessions');
const { Actor } = require(appRoot + '/lib/model/frames');

describe('task: reap-sessions', () => {
  it('should remove expired sessions', testTask(({ oneFirst, Actors, Sessions }) =>
    Actors.create(new Actor({ displayName: 'actor', type: 'actor' }))
      .then((actor) => Promise.all([ 2000, 2001, 2002, 2003, 3000, 3001, 3002, 3003 ]
        .map((year) => Sessions.create(actor, new Date(`${year}-01-01`)))))
      .then(() => reapSessions())
      .then(() => oneFirst(sql`
SELECT count(*) FROM sessions
JOIN actors ON actors.id = sessions."actorId" AND actors.type = 'actor'`))
      .then((count) => { count.should.equal(4); })));
});

