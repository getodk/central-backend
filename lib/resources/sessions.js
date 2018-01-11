const Problem = require('../problem');
const { isBlank, verifyPassword } = require('../util/util');
const { endpoint, getOrReject, success } = require('../util/http');

module.exports = (service, { User, Session }) => {

  service.post('/sessions', endpoint(({ body }) => {
    const { email, password } = body;

    if (isBlank(email) || isBlank(password))
      return Problem.user.missingParameters({ expected: [ 'email', 'password' ], got: { email, password } });

    return User.getByEmail(email)
      .then(getOrReject(Problem.user.authenticationFailed()))
      .then((user) => verifyPassword(password, user.password)
        .then((verified) => ((verified === true)
          ? Session.fromActor(user.actor).create()
          : Problem.user.authenticationFailed())));
  }));

  // here we always throw a 403 even if the token doesn't exist to prevent
  // information leakage.
  service.delete('/sessions/:token', endpoint(({ auth, params }) =>
    Session.getByBearerToken(params.token)
      .then(getOrReject(Problem.user.insufficientRights()))
      .then((token) => auth.canOrReject('endSession', token.actor)
        .then(() => token.delete())
        .then(success))))

};

