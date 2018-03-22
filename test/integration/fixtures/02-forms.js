
const { simple, withrepeat } = require('../data').forms;
const forms = [ simple, withrepeat ];

module.exports = ({ all, Form }) => all.inOrder(
  forms.map((xml) => Form.fromXml(xml).then((form) => form.create()))
).point();

