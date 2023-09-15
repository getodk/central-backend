const appRoot = require('app-root-path');
const { Form } = require(appRoot + '/lib/model/frames');
const { QueryOptions } = require(appRoot + '/lib/util/db');
const { simple, withrepeat } = require('../../data/xml').forms;
const forms = [ simple, withrepeat ];

module.exports = async ({ Actors, Assignments, Forms, Projects, Roles }) => {
  const project = (await Projects.getById(1)).get();
  /* eslint-disable no-await-in-loop */
  for (const xml of forms) {
    const partial = await Form.fromXml(xml);
    const { acteeId } = await Forms.createNew(partial, project, true);

    // Delete the formview actor created by Forms.createNew() in order to
    // maintain existing tests.
    const { id: roleId } = (await Roles.getBySystemName('formview')).get();
    const [{ actor }] = await Assignments.getByActeeAndRoleId(acteeId, roleId, QueryOptions.extended);
    await Actors.del(actor);
  }
  /* eslint-enable no-await-in-loop */
};

