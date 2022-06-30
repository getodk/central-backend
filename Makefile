.PHONY: test
default: base

node_modules: package.json
	npm install

node_version: node_modules
	node lib/bin/enforce-node-version.js

migrations: node_version
	node -e 'const { withDatabase, migrate } = require("./lib/model/migrate"); withDatabase(require("config").get("default.database"))(migrate);'

check-migrations: node_version
	node -e 'const { withDatabase, checkMigrations } = require("./lib/model/migrate"); withDatabase(require("config").get("default.database"))(checkMigrations);'

base: node_version migrations check-migrations

run: base
	node lib/bin/run-server.js

debug: base
	node --debug --inspect lib/bin/run-server.js

test: node_version
	env BCRYPT=no node node_modules/mocha/bin/mocha --recursive --exit
test-full: node_version
	node node_modules/mocha/bin/mocha --recursive --exit

test-integration: node_version
	node node_modules/mocha/bin/mocha --recursive test/integration --exit

test-unit: node_version
	node node_modules/mocha/bin/mocha --recursive test/unit --exit

test-coverage: node_version
	node node_modules/.bin/nyc -x "**/migrations/**" --reporter=lcov node_modules/.bin/_mocha --exit --recursive test

lint: node_version
	node node_modules/.bin/eslint --cache lib

run-multi: base
	node node_modules/naught/lib/main.js start --worker-count 4 lib/bin/run-server.js
stop-multi:
	node node_modules/naught/lib/main.js stop

run-docker-postgres: stop-docker-postgres
	docker run -d --name odk-postgres -p 5432:5432 -e POSTGRES_PASSWORD=odktest postgres:9.6
	sleep 5
	node .circleci/initdb.js

stop-docker-postgres:
	docker stop odk-postgres || true
	docker rm odk-postgres || true
