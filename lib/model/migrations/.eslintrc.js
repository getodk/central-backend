module.exports = {
  extends: '../../../.eslintrc.json',
  rules: {
    // Prevent migrations from including application code.
    //
    // Mixing application code into database migrations removes assurances that
    // the same migration will mutate the same postgresql data identically when
    // upgrading from/to different versions of the application.
    'no-restricted-modules': [ 'error', { patterns: [ '../*' ] } ],
  },
};
