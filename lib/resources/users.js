const { endpoint } = require('../util/http');

module.exports = (service, { User }) => {

  service.post('/users', endpoint(({ body }) =>
    (new User(body)).create())
  );

};

