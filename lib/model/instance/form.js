const { reduce } = require('ramda');
const { validate } = require('fast-xml-parser');
const { toTraversable, findAndTraverse, traverseFirstChild } = require('../../util/xml');
const Instance = require('./instance');
const ActeeTrait = require('../trait/actee');
const Problem = require('../../problem');
const { withCreateTime } = require('../../util/instance');
const Option = require('../../reused/option');
const { resolve, reject } = require('../../reused/promise');

module.exports = Instance.with(ActeeTrait)(({ simply, Form, forms }) => class {
  forCreate() { return withCreateTime(this); }
  create() { return forms.create(this); }

  forApi() { return this.without('id', 'acteeId', 'deletedAt'); }

  static fromXml(xml) {
    if (!validate(xml))
      return reject(Problem.user.unparseable({ format: 'xml', rawLength: xml.length }));
    const traversable = toTraversable(xml);

    const instanceNodePath = [ 'html', 'head', 'model', 'instance' ];
    const xmlFormId =
      Option.of(reduce(findAndTraverse, traversable, instanceNodePath))
        .map(traverseFirstChild)
        .map((data) => findAndTraverse(data, '@_id'))
        .map((idNode) => idNode.val);

    if (!xmlFormId.isDefined())
      return reject(Problem.user.missingParameter({ field: 'formId' }));
    return resolve(new Form({ xmlFormId: xmlFormId.get(), xml }));
  }

  static getByXmlFormId(xmlFormId) {
    return simply.getOneWhere('forms', { xmlFormId }, Form);
  }

  static getAll() { return forms.getAll(); }

  species() { return 'form'; }
});

