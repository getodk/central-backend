module.exports = {
  extends: '../.eslintrc.json',
  env: {
    mocha: true,
  },
  rules: {
    'func-names': 'off',
    'import/no-dynamic-require': 'off',
    'space-before-function-paren': 'off',
  }
};
