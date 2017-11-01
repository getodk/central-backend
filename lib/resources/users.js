const { endpoint } = require('../util/http');

module.exports = (service, { User, all }) => {

  service.post('/users', endpoint(({ body }) =>
    User.fromSerialize(body).create()));



};

