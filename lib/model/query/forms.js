
module.exports = {
  create: (form) => ({ actees, simply }) =>
    actees.transacting
      .provision('form')
      .then((actee) => simply.create('forms', form.with({ acteeId: actee.id })))
};

