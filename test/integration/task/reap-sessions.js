const appRoot = require('app-root-path');
const should = require('should');
const { testTask } = require('../setup');
const { reapSessions } = require(appRoot + '/lib/task/account');
const { Actor, Session } = require(appRoot + '/lib/model/frames');

describe('task: reap-sessions', () => {
  it('should remove expired sessions', testTask(({ oneFirst, Actors, Sessions }) =>
    Actors.create(new Actor({ displayName: 'actor', type: 'actor' }))
      .then((actor) => Promise.all([ 2000, 2001, 2002, 2003, 3000, 3001, 3002, 3003 ]
        .map((year) => Sessions.create(actor, `${year}-01-01` }))
      .then(() => Sessions.reap())
      .then(() => oneFirst(sql`select count(*) from sessions`))
      .then((count) => { count.should.equal(4); })));
});

