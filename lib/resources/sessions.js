const Problem = require('../problem');
const { isBlank } = require('../util/util');
const { endpoint } = require('../util/http');

module.exports = (service, { User }) => {

  service.post('/login/password', endpoint(({ body }) => {
    const { email, password } = body;

    if (isBlank(email) || isBlank(password))
      return Problem.user.missingParameters({ expected: [ 'email', 'password' ], got: { email, password } });

    return User.getByEmail(email).then((user) => {
      if ((user == null) || (password !== user.password))
        return Problem.user.authenticationFailed();

      return null; // TODO NEXT: create session token and return.
    });
  }));

};

