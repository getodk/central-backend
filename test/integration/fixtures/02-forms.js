
const appRoot = require('app-root-path');
const { mapSequential } = require(appRoot + '/lib/util/promise');
const { simple, withrepeat } = require('../../data/xml').forms;
const forms = [ simple, withrepeat ];

module.exports = ({ FormPartial }) => mapSequential(forms, (xml) =>
  FormPartial.fromXml(xml).then((partial) => partial.with({ projectId: 1 }).createNew(true)));

