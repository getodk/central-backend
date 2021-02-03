
const appRoot = require('app-root-path');
const { mapSequential } = require(appRoot + '/lib/util/promise');
const { Form } = require(appRoot + '/lib/model/frames');
const { simple, withrepeat } = require('../../data/xml').forms;
const forms = [ simple, withrepeat ];

module.exports = ({ Forms }) => mapSequential(forms, (xml) =>
  Form.fromXml(xml).then((partial) => Forms.createNew(partial.with({ projectId: 1 }), true)));

