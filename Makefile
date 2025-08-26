default: base

NODE_CONFIG_ENV ?= test

node_modules: package.json
	npm install
	touch node_modules

.PHONY: node_version
node_version: node_modules
	node lib/bin/enforce-node-version.js


################################################################################
# OIDC

.PHONY: test-oidc-integration
test-oidc-integration: node_version
	TEST_AUTH=oidc NODE_CONFIG_ENV=oidc-integration-test make test-integration

.PHONY: test-oidc-e2e
test-oidc-e2e: node_version
	test/e2e/oidc/run-tests.sh

.PHONY: dev-oidc
dev-oidc: base
	NODE_CONFIG_ENV=oidc-development npx nodemon --watch lib --watch config lib/bin/run-server.js

.PHONY: fake-oidc-server
fake-oidc-server:
	cd test/e2e/oidc/fake-oidc-server && \
	FAKE_OIDC_ROOT_URL=http://localhost:9898 npx nodemon index.mjs

.PHONY: fake-oidc-server-ci
fake-oidc-server-ci:
	cd test/e2e/oidc/fake-oidc-server && \
	node index.mjs


################################################################################
# S3

.PHONY: fake-s3-accounts
fake-s3-accounts: node_version
	NODE_CONFIG_ENV=s3-dev node lib/bin/s3-create-bucket.js

.PHONY: dev-s3
dev-s3: fake-s3-accounts base
	NODE_CONFIG_ENV=s3-dev npx nodemon --watch lib --watch config lib/bin/run-server.js

# default admin credentials: minioadmin:minioadmin
#   See: https://hub.docker.com/r/minio/minio/
# MINIO_KMS_SECRET_KEY, MINIO_KMS_AUTO_ENCRYPTION enable encryption - this changes how s3 ETags are generated.
#   See: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Object.html
#   See: https://github.com/minio/minio/discussions/19012
S3_SERVER_ARGS := --network host \
		-e MINIO_ROOT_USER=odk-central-dev \
		-e MINIO_ROOT_PASSWORD=topSecret123 \
		-e MINIO_KMS_AUTO_ENCRYPTION=on \
		-e MINIO_KMS_SECRET_KEY=odk-minio-test-key:QfdUCrn3UQ58W5pqCS5SX4SOlec9sT8yb4rZ4zK24w0= \
		minio/minio server /data --console-address ":9001"
.PHONY: fake-s3-server-ephemeral
fake-s3-server-ephemeral:
	docker run --rm $(S3_SERVER_ARGS)
.PHONY: fake-s3-server-persistent
fake-s3-server-persistent:
	docker run --detach $(S3_SERVER_ARGS)


################################################################################
# DATABASE MIGRATIONS

.PHONY: migrations
migrations: node_version
	node lib/bin/run-migrations.js


################################################################################
# RUN SERVER

.PHONY: base
base: node_modules node_version migrations

.PHONY: dev
dev: base
	npx nodemon --watch lib --watch config lib/bin/run-server.js

.PHONY: run
run: base
	node lib/bin/run-server.js

.PHONY: debug
debug: base
	node --debug --inspect lib/bin/run-server.js


################################################################################
# TEST & LINT

.PHONY: test
test: lint
	BCRYPT=insecure npx mocha --recursive

.PHONY: test-ci
test-ci: lint
	BCRYPT=insecure npx mocha --recursive --reporter test/ci-mocha-reporter.js

.PHONY: test-db-migrations
test-db-migrations:
	NODE_CONFIG_ENV=db-migration-test npx mocha --bail --sort --timeout=20000 \
	    --require test/db-migrations/mocha-setup.js \
	    ./test/db-migrations/**/*.spec.js

.PHONY: test-fast
test-fast: node_version
	NODE_CONFIG_ENV=test BCRYPT=insecure npx mocha --recursive --fgrep @slow --invert

.PHONY: test-integration
test-integration: node_version
	NODE_CONFIG_ENV=$(NODE_CONFIG_ENV) BCRYPT=insecure npx mocha --recursive test/integration

.PHONY: test-unit
test-unit: node_version
	NODE_CONFIG_ENV=test BCRYPT=insecure npx mocha --recursive test/unit

.PHONY: test-coverage
test-coverage: node_version
	NODE_CONFIG_ENV=test npx nyc -x "**/migrations/**" --reporter=lcov node_modules/.bin/_mocha --recursive test

.PHONY: lint
lint: node_version
	npx eslint --cache --max-warnings 0 .


################################################################################
# POSTGRES

.PHONY: run-docker-postgres
run-docker-postgres: stop-docker-postgres
	docker start odk-postgres14 || (\
		docker run -d --name odk-postgres14 -p 5432:5432 -e POSTGRES_PASSWORD=odktest postgres:14.10-alpine \
		&& sleep 5 \
		&& node lib/bin/create-docker-databases.js --log \
	)

.PHONY: stop-docker-postgres
stop-docker-postgres:
	docker stop odk-postgres14 || true

.PHONY: rm-docker-postgres
rm-docker-postgres: stop-docker-postgres
	docker rm odk-postgres14 || true


################################################################################
# OTHER

.PHONY: check-file-headers
check-file-headers:
	git ls-files | node lib/bin/check-file-headers.js

.PHONY: api-docs
api-docs:
	(test "$(docker images -q odk-docs)" || docker build --file odk-docs.dockerfile -t odk-docs .) && \
	docker run --rm -it -v ./docs:/docs/docs/_static/central-spec -p 8000:8000 odk-docs

.PHONY: api-docs-lint
api-docs-lint:
	npx --no @redocly/cli lint --extends=minimal docs/api.yaml
