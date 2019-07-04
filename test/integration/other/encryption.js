const should = require('should');
const { testContainer } = require('../setup');
const testData = require('../../data/xml');

describe('managed encryption', () => {
  it('should reject keyless forms in keyed projects @slow', testContainer(async (container) => {
    // enable managed encryption.
    await container.transacting(({ Project }) =>
      Project.getById(1).then((o) => o.get())
        .then((project) => project.setManagedEncryption('supersecret', 'it is a secret')));

    // now attempt to create a keyless form.
    let error;
    await container.transacting(({ Project, FormPartial }) =>
      Promise.all([
        Project.getById(1).then((o) => o.get()),
        FormPartial.fromXml(testData.forms.simple2)
      ])
        .then(([ project, partial ]) => partial.with({ projectId: project.id }).createNew())
        .catch((err) => { error = err; })
    );

    error.problemCode.should.equal(409.5);
  }));

  it('should reject forms created while project managed encryption is being enabled @slow', testContainer(async (container) => {
    // enable managed encryption but don't allow the transaction to close.
    let encReq;
    const unblock = await new Promise((resolve) => {
      encReq = container.transacting(({ Project }) => Promise.all([
        Project.getById(1).then((o) => o.get())
          .then((project) => project.setManagedEncryption('supersecret', 'it is a secret')),
        new Promise(resolve)
      ]));
    });

    // now we have to wait until the above query actually takes the necessary lock.
    const lockQuery = "select count(*) from pg_locks join pg_class on pg_locks.relation = pg_class.oid where pg_class.relname = 'form_defs' and pg_locks.granted = true;";
    const locked = () => container.db.raw(lockQuery).then(({ rows }) => rows[0].count > 0);
    const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
    const check = () => locked().then((isLocked) => isLocked
      ? true
      : wait(10).then(check));
    await check();

    // now that we are sure the lock has been taken, try to create the form.
    let error;
    const formReq = container.transacting(({ Project, FormPartial }) =>
      Promise.all([
        Project.getById(1).then((o) => o.get()),
        FormPartial.fromXml(testData.forms.simple2)
      ])
        .then(([ project, partial ]) => partial.with({ projectId: project.id }).createNew())
        .catch((err) => { error = err; })
    );

    // now unblock the managed encryption commit and let it all flush through.
    unblock();
    await formReq;
    await encReq;

    // now make sure we get the error we wanted.
    error.problemCode.should.equal(409.5);
  }));
});

