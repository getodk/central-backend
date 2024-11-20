module.exports = {
  extends: '../.eslintrc.js',
  rules: {
    'keyword-spacing': 'off',
    'no-multi-spaces': 'off',
    'no-plusplus': 'off',
    'no-use-before-define': 'off',
    'object-curly-newline': 'off',
    'prefer-arrow-callback': 'off',
  },
  globals: {
    db: false,
    log: false,
    sql: false,
  },
};
