// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

/*
This file is for use with the Knex migration CLI. Run `npx knex` from the
repository root, specifying the path of this file to --knexfile. Because the
Knex CLI will change the working directory to the directory of this file
(lib/model), you will also need to specify the NODE_CONFIG_DIR environment
variable so that `config` can find the configuration. (NODE_CONFIG_DIR may be a
relative path, but it will need to be relative to lib/model.) For example, in
local development:

NODE_CONFIG_DIR=../../config npx knex migrate:up --knexfile lib/model/knexfile.js 20211111-01-my-migration.js

In production (after the service is up):

docker compose exec --env NODE_CONFIG_DIR=../../config service npx knex migrate:up --knexfile lib/model/knexfile.js 20211111-01-my-migration.js

The DEBUG environment variable can also be helpful. For example:

NODE_CONFIG_DIR=../../config DEBUG=knex:query,knex:bindings npx knex migrate:up --knexfile lib/model/knexfile.js 20211111-01-my-migration.js
*/

const config = require('config');
const { knexConnection } = require('../util/db');

module.exports = {
  client: 'pg',
  connection: knexConnection(config.get('default.database'))
};

