const up = (db) => db.raw(`
  UPDATE entity_def_sources
  SET details = details || jsonb_build_object('created', details->'count', 'updated', 0)
  WHERE type = 'api'
    AND jsonb_exists(details, 'count')
`);

const down = () => {};

module.exports = { up, down };
