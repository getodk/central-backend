global.s3mock = {};

const defaults = {
  isEnabled: () => false,
};

const reset = () => {
  Object.assign(global.s3mock, defaults);
};

module.exports = { reset, s3: global.s3mock };
