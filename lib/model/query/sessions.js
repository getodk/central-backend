
module.exports = {
  getByBearerToken: (token) => ({ simply, Session, Actor }) =>
    simply.getOneWhere('sessions', [ { token }, [ 'expires', '>', 'now()' ] ], Session)
}

