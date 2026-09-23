const { hash, randomBytes } = require('node:crypto');
const { last } = require('ramda');

const aFormDefWith = (props) => {
  const { xml } = props;
  const hashes = xml != null
    ? { hash: hash('md5', xml), sha: hash('sha1', xml), sha256: hash('sha256', xml) }
    : null;
  return { version: '', ...hashes, ...props };
};

// Returns fixtures for multiple form_fields that are part of a single, shared
// schema.
const formFieldsWith = (sharedProps, ...fields) => fields.map((props, i) => {
  const result = { order: i, ...sharedProps, ...props };
  if (result.name == null && result.path != null)
    result.name = last(result.path.split('/'));
  return result;
});

const aBlobWith = props => {
  const randomContent = randomBytes(100);
  const md5 = hash('md5',  randomContent); // eslint-disable-line no-multi-spaces
  const sha = hash('sha1', randomContent);
  return { md5, sha, ...props };
};
const aBlob = () => aBlobWith({});

module.exports = {
  aFormDefWith,
  formFieldsWith,
  aBlob,
  aBlobWith
};
