module.exports = {
  extends: '../.eslintrc.js',
  rules: {
    'keyword-spacing': 'off',
    'no-use-before-define': 'off',
  },
  globals: {
    db: false,
    log: false,
    sql: false,
  },
};
