const appRoot = require('app-root-path');
const should = require('should');
const { testTask } = require('../setup');
const { reapSessions } = require(appRoot + '/lib/task/account');

describe('task: reap-sessions', () => {
  it('should remove expired sessions', testTask(({ simply, Actor, Session }) =>
    (new Actor({ displayName: 'actor', type: 'actor' })).create()
      .then((actor) => Promise.all([ 2000, 2001, 2002, 2003, 3000, 3001, 3002, 3003 ]
        .map((year) => Session.fromActor(actor).with({ expiresAt: `${year}-01-01` }).create())))
      .then(() => Session.reap())
      .then(() => simply.countWhere('sessions'))
      .then((count) => { count.should.equal(4); })));
});

