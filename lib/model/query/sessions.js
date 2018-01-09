
module.exports = {
  getByBearerToken: (token) => ({ simply, Session }) =>
    simply.getOneWhere('sessions', [ { token }, [ 'expiresAt', '>', 'now()' ] ], Session)
};

