const appRoot = require('app-root-path');
const { Form } = require(appRoot + '/lib/model/frames');
const { simple, withrepeat } = require('../../data/xml').forms;
const forms = [ simple, withrepeat ];

module.exports = async ({ Assignments, Forms, Projects, Roles }) => {
  const project = (await Projects.getById(1)).get();
  const { id: formview } = (await Roles.getBySystemName('formview')).get();

  /* eslint-disable no-await-in-loop */
  for (const xml of forms) {
    const partial = await Form.fromXml(xml);

    // Create the form without Enketo IDs in order to maintain existing tests.
    global.enketo.state = 'error';
    const form = await Forms.createNew(partial, project);

    // Publish the form without Enketo IDs as well
    global.enketo.state = 'error';
    await Forms.publish(form, true);

    // Delete the assignment of the formview actor created by Forms.createNew()
    // in order to maintain existing tests.
    const [{ actorId }] = await Assignments.getByActeeAndRoleId(form.acteeId, formview);
    await Assignments.revokeByActorId(actorId);
  }
  /* eslint-enable no-await-in-loop */

  // Reset enketo call count and error state to not affect tests
  global.enketo.callCount = 0;
};

