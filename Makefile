default: base

node_modules: package.json
	npm install

.PHONY: node_version
node_version: node_modules
	node lib/bin/enforce-node-version.js

.PHONY: migrations
migrations: node_version
	node lib/bin/run-migrations.js

.PHONY: check-migrations
check-migrations: node_version
	node lib/bin/check-migrations.js

.PHONY: base
base: node_version migrations check-migrations

.PHONY: run
run: base
	node lib/bin/run-server.js

.PHONY: debug
debug: base
	node --debug --inspect lib/bin/run-server.js

.PHONY: test
test: node_version
	env BCRYPT=no node node_modules/mocha/bin/mocha --recursive --exit
.PHONY: test-full
test-full: node_version
	node node_modules/mocha/bin/mocha --recursive --exit

.PHONY: test-integration
test-integration: node_version
	node node_modules/mocha/bin/mocha --recursive test/integration --exit

.PHONY: test-unit
test-unit: node_version
	node node_modules/mocha/bin/mocha --recursive test/unit --exit

.PHONY: test-coverage
test-coverage: node_version
	node node_modules/.bin/nyc -x "**/migrations/**" --reporter=lcov node_modules/.bin/_mocha --exit --recursive test

.PHONY: lint
lint: node_version
	node node_modules/.bin/eslint --cache lib

.PHONY: run-docker-postgres
run-docker-postgres: stop-docker-postgres
	docker run -d --name odk-postgres -p 5432:5432 -e POSTGRES_PASSWORD=odktest postgres:9.6
	sleep 5
	node .circleci/initdb.js

.PHONY: stop-docker-postgres
stop-docker-postgres:
	docker stop odk-postgres || true
	docker rm odk-postgres || true
