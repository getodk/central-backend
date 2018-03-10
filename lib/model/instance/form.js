const { reduce, merge } = require('ramda');
const { validate } = require('fast-xml-parser');
const { createHash } = require('crypto');
const { toTraversable, findAndTraverse, traverseFirstChild } = require('../../util/xml');
const Instance = require('./instance');
const ActeeTrait = require('../trait/actee');
const Problem = require('../../util/problem');
const { isBlank } = require('../../util/util');
const { withCreateTime } = require('../../util/instance');
const Option = require('../../util/option');
const { resolve, reject } = require('../../util/promise');

const formFields = [ 'id', 'xmlFormId', 'xml', 'version', 'hash', 'name', 'acteeId', 'createdAt', 'updatedAt', 'deletedAt' ];
Object.freeze(formFields);

module.exports = Instance.with(ActeeTrait)(({ Form, forms }) => class {
  forCreate() { return withCreateTime(this); }
  create() { return forms.create(this); }

  forApi() {
    // TODO: generally better handling of extended metadata output.
    const additional = (this.createdBy != null)
      ? { createdBy: this.createdBy.map((actor) => actor.forApi()).orNull() }
      : {};
    return merge(this.without('id', 'acteeId', 'deletedAt'), additional);
  }

  static fromXml(xml) {
    if (!validate(xml))
      return reject(Problem.user.unparseable({ format: 'xml', rawLength: xml.length }));
    const traversable = toTraversable(xml);

    // find the data node nested inside instance (which has no definite name).
    const instanceNodePath = [ 'html', 'head', 'model', 'instance' ];
    const dataNode =
      Option.of(reduce(findAndTraverse, traversable, instanceNodePath))
        .map(traverseFirstChild);

    // first check for a form id, as we can fail early if we can't find one.
    const xmlFormId =
      dataNode
        .map((data) => findAndTraverse(data, '@_id'))
        .map((idNode) => idNode.val);
    if (!xmlFormId.isDefined() || isBlank(xmlFormId.get()))
      return reject(Problem.user.missingParameter({ field: 'formId' }));

    // find and cache version.
    const version =
      dataNode
        .map((data) => findAndTraverse(data, '@_version'))
        .map((versionNode) => versionNode.val)
        .orNull();

    // find and cache form name.
    const name =
      Option.of(reduce(findAndTraverse, traversable, [ 'html', 'head', 'title' ]))
        .map((titleNode) => titleNode.val)
        .orNull();

    // hash and cache the xml.
    const hash = createHash('md5').update(xml).digest('hex');
    return resolve(new Form({ xmlFormId: xmlFormId.get(), xml, name, version, hash }));
  }

  static getByXmlFormId(xmlFormId, extended) {
    return forms.getByXmlFormId(xmlFormId, extended);
  }

  static getAll(extended) { return forms.getAll(extended); }

  species() { return 'form'; }

  static fields() { return formFields; }
});

