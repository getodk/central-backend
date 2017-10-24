// model packaging solves a problem created by database dependency injection:
// models cannot easily reference each other directly. the solution, which also
// allows more-granular testing of cross-model behaviour, is to inject the
// models themselves as well.
//
// what this package does is initialize all our models with a given database as
// well as an object which at the end of the initialization process will contain
// all the models of the application. because class definitions are inert code,
// the references will be available by the time anybody needs them.

module.exports = (db) => {
  const models = {};
  for (const model of [ 'Actee', 'Actor', 'Grant', 'User', 'Form' ]) {
    models[model] = require(`./${model.toLowerCase()}`)({ db, models });
  }
  return models;
};

