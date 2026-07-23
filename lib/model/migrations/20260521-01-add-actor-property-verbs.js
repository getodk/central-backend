// Adds new verbs:
//  - actor_property.list: for the new actor_property feature; available to viewers, managers, and admins
//  - actor_property.update: for setting/unsetting property values; managers and admins only
//  - field_key.update: was missing from the verb set. added for consistency with
//    field_key.create, field_key.list, and field_key.delete already held by managers and admins
//    as well as public_link.* verbs

const up = async (db) => {
  await db.raw(`
    UPDATE roles
    SET verbs = verbs || '["actor_property.list"]'::jsonb
    WHERE system in ('admin', 'manager', 'viewer')
  `);
  await db.raw(`
    UPDATE roles
    SET verbs = verbs || '["actor_property.update", "field_key.update"]'::jsonb
    WHERE system in ('admin', 'manager')
  `);
};

const down = async (db) => {
  await db.raw(`
    UPDATE roles
    SET verbs = (verbs - 'actor_property.list')
    WHERE system in ('admin', 'manager', 'viewer')
  `);

  await db.raw(`
    UPDATE roles
    SET verbs = (verbs - 'actor_property.update' - 'field_key.update')
    WHERE system in ('admin', 'manager')
  `);
};

module.exports = { up, down };
