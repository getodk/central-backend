#!/bin/sh
DEBUG=knex:tx NODE_CONFIG_DIR=../../config node --preserve-symlinks node_modules/knex/bin/cli.js --knexfile lib/model/knexfile.js ${@}
