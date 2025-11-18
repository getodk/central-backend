const appRoot = require('app-root-path');

const should = require('should');
const { testService } = require('../setup');
const { exhaust } = require(appRoot + '/lib/worker/worker');


describe('worker: user', () => {

  it('should opt-in user to mailing list when preference changes', testService(async (service, container) => {
    const asAlice = await service.login('alice');

    await asAlice.put('/v1/user-preferences/site/mailingListOptIn')
      .send({ propertyValue: true })
      .expect(200);

    await exhaust(container);

    container.mailingListReporter.dataSent.includes('id="mailing_list_opt_in" version="test-version"').should.be.true();
    container.mailingListReporter.dataSent.includes('><email>alice@getodk.org</email>').should.be.true();
  }));

  it('should not opt-in user if preference is set to false immediately after', testService(async (service, container) => {
    const asAlice = await service.login('alice');

    await asAlice.put('/v1/user-preferences/site/mailingListOptIn')
      .send({ propertyValue: true })
      .expect(200);

    await asAlice.put('/v1/user-preferences/site/mailingListOptIn')
      .send({ propertyValue: false })
      .expect(200);

    await exhaust(container);

    should.equal(container.mailingListReporter.dataSent, null);
  }));

});

