
module.exports = {
  getByBearerToken: (token) => ({ simply, Session, Actor }) =>
    simply.getOneWhere('sessions', [ { token }, [ 'expires', '>', 'now()' ] ], Session)
      .then((maybeSession) => maybeSession.map((session) =>
        simply.getById(session.actorId)
          .then((actor) => session.with(actor))))
}

