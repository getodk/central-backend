.PHONY: test
default: base

node_modules:
	npm install

migrations: node_modules
	node -e 'const { withDatabase, migrate } = require("./lib/model/database"); withDatabase(require("config").get("default.database"))(migrate);'

base: node_modules migrations

run: base
	node lib/bin/run-server.js

debug: base
	./node_modules/nodemon/bin/nodemon.js --debug --inspect=0.0.0.0:9229 lib/bin/run-server.js

# the default test timeout of 2000 ms is too short for some dev. machines.
# consider increasing it more if you experience sporadic failures.
mocha_command  = node node_modules/mocha/bin/mocha --recursive --timeout 5000

test: node_modules
	env BCRYPT=no $(mocha_command)
test-full: node_modules
	$(mocha_command)

test-integration: node_modules
	$(mocha_command) test/integration

test-unit: node_modules
	$(mocha_command) test/unit

test-coverage: node_modules
	node node_modules/.bin/nyc -x "**/migrations/**" --reporter=lcov node_modules/.bin/_mocha --exit --recursive test

lint:
	node node_modules/.bin/eslint lib

run-multi: base
	node node_modules/naught/lib/main.js start --worker-count 4 lib/bin/run-server.js
stop-multi:
	node node_modules/naught/lib/main.js stop

