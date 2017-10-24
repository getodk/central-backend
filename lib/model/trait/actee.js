const { Trait } = require('../../util/util');
const { ensureTransaction } = require('../../util/db');

const AsActee = Trait((superclass, { db, models }) => class extends superclass {
  // If necessary, provisions a new Actee ID, then creates this record that Actee ID.
  create(maybeTrxn) {
    if (this.data.acteeId == null)
      return ensureTransaction(db, maybeTrxn, (trxn) =>
        models.Actee.provision(this.data.type, trxn)
          .then((acteeId) => this.with({ acteeId }).create(trxn))
      );
    else
      return super.create(maybeTrxn);
  }

  get acteeId() { return this.data.acteeId; }

  acteeIds() {
    return [ this.data.acteeId, this.constructor.species(), '*' ];
  }
});

module.exports = AsActee;

