const up = (knex) =>
  knex.raw('create unique index forms_xmlformid_deletedat_unique on forms ("xmlFormId") where "deletedAt" is null;')
    .then(() => knex.schema.table('forms', (forms) => {
      forms.dropUnique('xmlFormId');
      forms.unique([ 'xmlFormId', 'version' ]);
    }));

// this migration is provided but it /will not work/ in all scenarios!
// if it is failing for you, it is relatively safe to just skip it.
const down = () => (knex) =>
  knex.schema.table('forms', (forms) => {
    forms.dropUnique([ 'xmlFormId', 'version' ]);
    forms.unique('xmlFormId');
  }).then(() => knex.raw('drop index forms_xmlformid_deletedat_unique'));

module.exports = { up, down };

