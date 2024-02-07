/* eslint-disable quote-props */
module.exports = {
  env: {
    commonjs: true,
    es2021: true,
    node: true,
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 'latest',
  },
  rules: {
    'indent': 'off',
    'key-spacing': 'off',
    'keyword-spacing': 'off',
    'no-console': 'off',
    'no-mixed-operators': 'off',
    'no-multi-spaces': 'off',
    'no-plusplus': 'off',
    'no-return-assign': 'off',
    'no-shadow': 'off',
    'no-undef-init': 'error',
    'no-unused-expressions': 'error',
    'no-use-before-define': [ 'error', { functions:false } ],
    'semi': [ 'error', 'always' ],
    'semi-style': 'off',
    'space-in-parens': 'off',
    'switch-colon-spacing': 'off',
  },
};
