#!/bin/bash -eu
set -o pipefail

serverUrl="http://localhost:8383"
userEmail="x@example.com"
userPassword="secret1234"

log() { echo "[test/e2e/s3/run-tests] $*"; }

cleanup() {
  if [[ -n "${_cleanupStarted-}" ]]; then return; fi
  _cleanupStarted=1 # track to prevent recursive cleanup

  log "Cleaning up background service(s); ignore subsequent errors."
  set +eo pipefail
  kill -- -$$
}
trap cleanup EXIT SIGINT SIGTERM SIGHUP

if curl -s -o /dev/null $serverUrl; then
  log "!!! Error: server already running at: $serverUrl"
  exit 1
fi

make base

if [[ "${CI-}" = '' ]]; then
  set +e
fi

log "Attempting to create user..."
echo "$userPassword" | node ./lib/bin/cli.js user-create  -u "$userEmail" && log "User created."
log "Attempting to promote user..."
node ./lib/bin/cli.js user-promote -u "$userEmail" && log "User promoted."

if [[ "${CI-}" = '' ]]; then
  set -e
  cat <<EOF

    ! It looks like you're running this script outside of a CI environment.
    !
    ! If your blobs table is not empty, you may see test failures due to
    ! de-duplication of blobs.
    !
    ! A quick fix for this could be:
    !
    !   docker exec odk-postgres14 psql -U jubilant jubilant -c "TRUNCATE blobs CASCADE"
    !
    ! Press <enter> to continue...

EOF
  read -rp ''
fi

run_suite() {
  suite="$1"
  configEnv="$2"

  case "$suite" in
    smoke) testOptions="--fgrep @smoke-test" ;;
    all)   testOptions="" ;;
    *) log "Unrecongised test suite: $suite"; exit 1 ;;
  esac

  NODE_CONFIG_ENV="$configEnv" node lib/bin/s3-create-bucket.js
  NODE_CONFIG_ENV="$configEnv" make run &
  serverPid=$!

  log 'Waiting for backend to start...'
  timeout 30 bash -c "while ! curl -s -o /dev/null $serverUrl; do sleep 1; done"
  log 'Backend started!'

  cd test/e2e/s3
  NODE_CONFIG_ENV="$configEnv" npx mocha "$testOptions" test.js

  if ! curl -s -o /dev/null "$serverUrl"; then
    log '!!! Backend died.'
    exit 1
  fi

  kill "$serverPid"
  wait "$serverPid"
}

run_suite smoke s3-dev-with-region
run_suite smoke s3-dev-blank-region
run_suite all   s3-dev

log "Tests completed OK."
