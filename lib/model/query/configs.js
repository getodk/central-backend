module.exports = {
  // Will update the existing record of the given key if present, or else create it.
  set: (record) => ({ db }) =>
    db.raw('? on conflict (key) do update set value = ?, "setAt" = ?', [
      db.insert(record.with({ setAt: new Date() })).into('config'),
      record.value,
      new Date()
    ])
};

