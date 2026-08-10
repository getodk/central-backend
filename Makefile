default: base

SHELL := /usr/bin/env bash

NODE_CONFIG_ENV ?= test
export PGAPPNAME ?= odkcentral

PG_IMG = odk-central-backend-dev-postgres
PG_VERSION ?= 14

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
S3_SERVER_ARGS := -p 127.0.0.1:9000:9000 -p 127.0.0.1:9001:9001 \
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
	$(MAKE) test-unit
	$(MAKE) test-integration

.PHONY: test-db-migrations
test-db-migrations:
	NODE_CONFIG_ENV=db-migration-test npx mocha --bail --sort --timeout=20000 \
	    --require test/db-migrations/mocha-setup.js \
	    ./test/db-migrations/**/*.spec.js

.PHONY: test-db-ssl
test-db-ssl:
	NODE_CONFIG_ENV=db-migration-test npx mocha --sort --timeout=20000 \
	    --require test/db-ssl/mocha-setup.js \
	    ./test/db-ssl/**/*.spec.js

.PHONY: test-fast
test-fast: node_version
	MOCHA_OPTIONS="--fgrep @slow --invert" $(MAKE) test-unit
	MOCHA_OPTIONS="--fgrep @slow --invert" $(MAKE) test-integration

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
	ESLINT_USE_FLAT_CONFIG=false \
	npx eslint --cache --max-warnings 0 . \
	2> >(grep -Ev 'ESLintRCWarning|--trace-warnings' >&2) # filter eslintrc deprecation warning


################################################################################
# POSTGRES

.PHONY: run-docker-postgres
run-docker-postgres: stop-docker-postgres
	docker start $(PG_IMG) || (\
		docker run -d \
			--name $(PG_IMG) \
			--publish 127.0.0.1:5432:5432 \
			--env POSTGRES_PASSWORD=odktest \
			postgres:$(PG_VERSION) \
				--shared_preload_libraries=pg_stat_statements \
		&& sleep 2 \
		&& docker exec $(PG_IMG) pg_isready --username=postgres --timeout=10 \
		&& node lib/bin/create-docker-databases.js $(if $(CI),,--log) \
	)

.PHONY: run-docker-postgres-ssl
run-docker-postgres-ssl: stop-docker-postgres-ssl
	mkdir -p .pg-certs && \
	(cd .pg-certs && [[ -s ca.key     ]] || openssl genrsa -out ca.key 2048) && \
	(cd .pg-certs && [[ -s ca.crt     ]] || openssl req -x509 -new -nodes -key ca.key -sha256 -days 1 -out ca.crt -subj "/CN=TestCA") && \
	(cd .pg-certs && [[ -s server.key ]] || openssl genrsa -out server.key 2048) && \
	(cd .pg-certs && [[ -s server.csr ]] || openssl req -new -key server.key -out server.csr -subj "/CN=localhost") && \
	(cd .pg-certs && [[ -s server.crt ]] || openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 1 -sha256 -extfile <(printf "subjectAltName=DNS:localhost,IP:127.0.0.1")) && \
	sudo chown -R 999:999 .pg-certs && \
	sudo -k && \
	docker start $(PG_IMG)-ssl || (\
		docker run -d \
			--name $(PG_IMG)-ssl \
			--publish 127.0.0.1:5432:5432 \
			--env POSTGRES_PASSWORD=odktest \
			--volume $(PWD)/.pg-certs:/postgres-certs \
			postgres:$(PG_VERSION) \
				--shared_preload_libraries=pg_stat_statements \
				--ssl=on \
				--ssl_cert_file=/postgres-certs/server.crt \
				--ssl_key_file=/postgres-certs/server.key \
		&& sleep 2 \
		&& docker exec $(PG_IMG)-ssl pg_isready --username=postgres --timeout=10 \
		&& node lib/bin/create-docker-databases.js $(if $(CI),,--log) \
	)

.PHONY: stop-docker-postgres
stop-docker-postgres:
	docker stop $(PG_IMG) || true

.PHONY: stop-docker-postgres-ssl
stop-docker-postgres-ssl:
	docker stop $(PG_IMG)-ssl || true

.PHONY: rm-docker-postgres
rm-docker-postgres: stop-docker-postgres
	docker rm $(PG_IMG) || true

.PHONY: rm-docker-postgres-ssl
rm-docker-postgres-ssl: stop-docker-postgres-ssl
	docker rm $(PG_IMG)-ssl || true


################################################################################
# OTHER

.PHONY: check-for-large-files
check-for-large-files:
	./test/check-for-large-files.sh

.PHONY: api-docs
api-docs:
	(test "$(docker images -q odk-docs)" || docker build --file odk-docs.dockerfile -t odk-docs .) && \
	docker run --rm -it -v ./docs:/docs/docs/_static/central-spec -p 127.0.0.1:8000:8000 odk-docs

.PHONY: api-docs-lint
api-docs-lint:
	node lib/bin/openapi-docs-lint.js docs/api.yaml && \
	npx --no @redocly/cli lint --config docs/redocly.conf.yaml docs/api.yaml
