const Problem = require('../problem');
const { isBlank } = require('../util/util');
const { endpoint } = require('../util/http');

module.exports = (service, { Actor, User, Session }) => {

  service.post('/login/password', endpoint(({ body }) => {
    const { email, password } = body;

    if (isBlank(email) || isBlank(password))
      return Problem.user.missingParameters({ expected: [ 'email', 'password' ], got: { email, password } });

    return User.getByEmail(email).then((user) => {
      if ((user == null) || (password !== user.password))
        return Problem.user.authenticationFailed();
      else
        user.actor
        // TODO NEXT: create session token and return.
    });
  }));

};

