
const { simple, withrepeat } = require('../../data/xml').forms;
const forms = [ simple, withrepeat ];

module.exports = ({ all, FormPartial }) => all.mapSequential(forms, (xml) =>
  FormPartial.fromXml(xml).then((partial) => partial.with({ projectId: 1 }).createNew(true)));

