default: base

node_modules: package.json
	npm install --legacy-peer-deps
	touch node_modules

.PHONY: test-oidc-integration
test-oidc-integration: node_modules
	TEST_AUTH=oidc NODE_CONFIG_ENV=oidc-integration-test make test-integration

.PHONY: test-oidc-e2e
test-oidc-e2e: node_modules
	cd oidc-dev && \
	docker compose down && \
	docker compose build && \
	docker compose up --exit-code-from odk-central-oidc-tester

.PHONY: dev-oidc
dev-oidc: base
	NODE_CONFIG_ENV=oidc-development npx nodemon --watch lib --watch config lib/bin/run-server.js

.PHONY: fake-oidc-server
fake-oidc-server:
	cd oidc-dev/fake-oidc-server && \
	npm clean-install && \
	FAKE_OIDC_ROOT_URL=http://localhost:9898 npx nodemon index.js

.PHONY: fake-oidc-server-ci
fake-oidc-server-ci:
	cd oidc-dev/fake-oidc-server && \
	npm clean-install && \
	FAKE_OIDC_ROOT_URL=http://localhost:9898 node index.js

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

.PHONY: dev
dev: base
	npx nodemon --watch lib --watch config lib/bin/run-server.js

.PHONY: run
run: base
	node lib/bin/run-server.js

.PHONY: debug
debug: base
	node --debug --inspect lib/bin/run-server.js

.PHONY: test
test: lint
	BCRYPT=no npx mocha --recursive --exit
.PHONY: test-full
test-full: lint
	npx mocha --recursive --exit

.PHONY: test-integration
test-integration: node_version
	BCRYPT=no npx mocha --recursive test/integration --exit

.PHONY: test-unit
test-unit: node_version
	npx mocha --recursive test/unit --exit

.PHONY: test-coverage
test-coverage: node_version
	npx nyc -x "**/migrations/**" --reporter=lcov node_modules/.bin/_mocha --exit --recursive test

.PHONY: lint
lint: node_version
	npx eslint --cache --max-warnings 0 .

.PHONY: run-docker-postgres
run-docker-postgres: stop-docker-postgres
	docker start odk-postgres14 || (docker run -d --name odk-postgres14 -p 5432:5432 -e POSTGRES_PASSWORD=odktest postgres:14.6 && sleep 5 && node lib/bin/create-docker-databases.js)

.PHONY: stop-docker-postgres
stop-docker-postgres:
	docker stop odk-postgres14 || true

.PHONY: rm-docker-postgres
rm-docker-postgres: stop-docker-postgres
	docker rm odk-postgres14 || true

.PHONY: check-file-headers
check-file-headers:
	git ls-files | node lib/bin/check-file-headers.js
