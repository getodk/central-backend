const appRoot = require('app-root-path');
const should = require('should');
const { testTask } = require('../setup');
const { reapSessions } = require(appRoot + '/lib/task/account');

describe('task: reap-preview_keys', () => {
  it('should remove expired preview keys', testTask(({ simply, Actor }) => {
    const fifteenMinutesAgo = new Date();
    fifteenMinutesAgo.setMinutes(fifteenMinutesAgo.getMinutes() - 15);
    return Promise.all([
      (new Actor({ displayName: 'expired', type: Actor.types().previewKey, expiresAt: fifteenMinutesAgo })).create(),
      (new Actor({ displayName: 'current', type: Actor.types().previewKey })).create()
    ])
      .then(() => Actor.reapPreviewKeys())
      .then(() => simply.countWhere('actors', { type: Actor.types().previewKey }))
      .then((count) => { count.should.equal(1); })
      .then(() => simply.getOneWhere('actors', { type: Actor.types().previewKey }, Actor))
      .then((actor) => actor.get().displayName.should.equal('current'));
  }));
});

