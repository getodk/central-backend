default: base

node_modules: package.json
	npm install --legacy-peer-deps
	touch node_modules

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
	BCRYPT=insecure npx mocha --recursive --exit

.PHONY: test-ci
test-ci: lint
	BCRYPT=insecure npx mocha --recursive --exit --reporter test/ci-mocha-reporter.js

.PHONY: test-fast
test-fast: node_version
	BCRYPT=insecure npx mocha --recursive --exit --fgrep @slow --invert

.PHONY: test-integration
test-integration: node_version
	BCRYPT=insecure npx mocha --recursive test/integration --exit

.PHONY: test-unit
test-unit: node_version
	BCRYPT=insecure npx mocha --recursive test/unit --exit

.PHONY: test-coverage
test-coverage: node_version
	npx nyc -x "**/migrations/**" --reporter=lcov node_modules/.bin/_mocha --exit --recursive test

.PHONY: lint
lint: node_version
	npx eslint --cache --max-warnings 0 .

.PHONY: run-docker-postgres
run-docker-postgres: stop-docker-postgres
	docker start odk-postgres14 || (\
		docker run -d --name odk-postgres14 -p 5432:5432 -e POSTGRES_PASSWORD=odktest postgres:14.10-alpine \
			postgres -c log_statement=all -c log_destination=stderr -c log_parameter_max_length=80 \
		&& sleep 5 \
		&& node lib/bin/create-docker-databases.js \
	)

.PHONY: stop-docker-postgres
stop-docker-postgres:
	docker stop odk-postgres14 || true

.PHONY: rm-docker-postgres
rm-docker-postgres: stop-docker-postgres
	docker rm odk-postgres14 || true

.PHONY: check-file-headers
check-file-headers:
	git ls-files | node lib/bin/check-file-headers.js

.PHONY: api-docs
api-docs:
	(test "$(docker images -q odk-docs)" || docker build --file odk-docs.dockerfile -t odk-docs .) && \
	docker run --rm -it -v ./docs:/docs/docs/_static/central-spec -p 8000:8000 odk-docs
