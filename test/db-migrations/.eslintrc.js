module.exports = {
  extends: '../.eslintrc.js',
  rules: {
    'key-spacing': 'off',
    'keyword-spacing': 'off',
    'no-console': 'off',
    'no-multi-spaces': 'off',
    'no-plusplus': 'off',
    'no-use-before-define': 'off',
    'object-curly-newline': 'off',
    'prefer-arrow-callback': 'off',
  },
  globals: {
    assert: false,
    db: false,
    log: false,
    sql: false,
  },
};
