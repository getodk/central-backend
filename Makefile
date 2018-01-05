default: base

node_modules:
	npm install

migrations: node_modules
	node -e 'const { withDatabase, migrate } = require("./lib/model/database"); withDatabase(migrate);'

base: node_modules migrations

run: base
	node lib/run-server.js

debug: base
	node --debug --inspect lib/run-server.js

test: node_modules
	node node_modules/mocha/bin/mocha --recursive

test-api: node_modules
	node node_modules/mocha/bin/mocha --recursive test/api

test-unit: node_modules
	node node_modules/mocha/bin/mocha --recursive test/unit

test-coverage: node_modules
	node node_modules/.bin/istanbul cover node_modules/.bin/_mocha -- --recursive

lint:
	node node_modules/.bin/eslint lib

run-multi: base
	node node_modules/naught/lib/main.js start --worker-count 4 lib/run-server.js
stop-multi:
	node node_modules/naught/lib/main.js stop

