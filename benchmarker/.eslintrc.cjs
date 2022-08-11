module.exports = {
  env: {
    commonjs: true,
    es2021: true,
    node: true,
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 13,
  },
  rules: {
    'indent': 'off',
    'key-spacing': 'off',
    'keyword-spacing': 'off',
    'no-await-in-loop': 'off',
    'no-console': 'off',
    'no-multi-spaces': 'off',
    'no-plusplus': 'off',
    'no-use-before-define': ['error', 'nofunc'],
    'semi-style': 'off',
    'switch-colon-spacing': 'off',
  },
};
