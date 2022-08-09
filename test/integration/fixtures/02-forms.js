
const appRoot = require('app-root-path');
// eslint-disable-next-line import/no-dynamic-require
const { mapSequential } = require(appRoot + '/test/util/util');
// eslint-disable-next-line import/no-dynamic-require
const { Form } = require(appRoot + '/lib/model/frames');
const { simple, withrepeat } = require('../../data/xml').forms;
const forms = [ simple, withrepeat ];

module.exports = ({ Forms, Projects }) =>
  Projects.getById(1)
    .then((option) => option.get())
    .then((project) => mapSequential(forms, (xml) =>
      Form.fromXml(xml).then((partial) => Forms.createNew(partial, project, true))));

