const appRoot = require('app-root-path');
const should = require('should');
const { sql } = require('slonik');
const { testTask } = require('../setup');
const { reapSessions } = require(appRoot + '/lib/task/reap-sessions');
const { Actor } = require(appRoot + '/lib/model/frames');

describe('task: analytics', () => {
  it('to do', testTask(({ Config, Analytics }) => Promise.resolve()));
});

