const appRoot = require('app-root-path');
const should = require('should');
const { resolve } = require(appRoot + '/lib/util/promise');
const { task } = require(appRoot + '/lib/task/task');

describe('task harness', () => {
  describe('container-based tasks', () => {
    it('should spawn a container but not until the task runs', () => {
      let givenContainer = null;
      const testTask = task.withContainer('test', (container) => () => {
        givenContainer = container;
        should.exist(container.db);
        return resolve(true);
      });
      should.not.exist(givenContainer);
      return testTask();
    });

    it('should pass arguments to the task', () =>
      task.withContainer('test', () => (x, y, z) => {
        x.should.equal(1);
        y.should.equal(2);
        z.should.equal(3);
        return resolve(true);
      })(1, 2, 3));

    it('should reuse containers for nested tasks', () =>
      task.withContainer('test', (containerA) => () =>
        task.withContainer('test', (containerB) => () => {
          containerA.should.equal(containerB);
          return resolve(true);
        })())());

    it.skip('should teardown containers after completion', () => {
      let torndown = false;
      const outer = task.withContainer('test', (container) => () => {
        // hijack the destroy func:
        const origDestroy = container.db.destroy;
        // eslint-disable-next-line no-param-reassign
        container.db.destroy = () => {
          torndown = true;
          origDestroy.call(container.db);
        };
        return task.withContainer('test', () => () => {
          torndown.should.equal(false);
          return resolve(true);
        })().then(() => torndown.should.equal(false));
      });
      return outer().then(() => torndown.should.equal(true));
    });
  });
});

