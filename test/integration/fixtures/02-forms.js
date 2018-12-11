
const { simple, withrepeat } = require('../data').forms;
const forms = [ simple, withrepeat ];

module.exports = ({ all, Form }) => all.mapSequential(forms, (xml) =>
  Form.fromXml(xml).then((form) => form.with({ projectId: 1 }).create()));

