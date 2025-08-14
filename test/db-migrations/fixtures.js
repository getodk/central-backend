const { hash, randomBytes } = require('node:crypto');

const aBlobWith = props => {
  const randomContent = randomBytes(100);
  const md5 = hash('md5',  randomContent); // eslint-disable-line no-multi-spaces
  const sha = hash('sha1', randomContent);
  return { md5, sha, ...props };
};
const aBlob = () => aBlobWith({});

module.exports = {
  aBlob,
  aBlobWith
};
