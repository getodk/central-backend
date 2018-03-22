module.exports = {
  set: (record) => ({ db }) =>
    db.raw('? on conflict (key) do update set value = ?', [
      db.insert(record).into('config'),
      record.value
    ])
};

