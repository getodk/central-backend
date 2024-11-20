module.exports = {
  extends: '../.eslintrc.js',
  rules: {
    'keyword-spacing': 'off',
    'no-use-before-define': 'off',
    'prefer-arrow-callback': 'off',
  },
  globals: {
    db: false,
    log: false,
    sql: false,
  },
};
