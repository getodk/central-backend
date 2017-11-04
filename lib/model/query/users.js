
module.exports = {
  create: (user) => ({ actors, simply }) =>
    actors.transacting
      .create(user.actor)
      .then((actor) => simply.create('users', user.with({ actor })))
};

