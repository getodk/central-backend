
module.exports = {
  create: (actor) => ({ actees, simply }) =>
    actees.transacting
      .provision(actor.type)
      .then((actee) => simply.create('actors', actor.with({ acteeId: actee.id })))
};

