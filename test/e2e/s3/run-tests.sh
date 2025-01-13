#!/bin/bash -eu
set -o pipefail

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

  log "Running suite '$suite' with config '$configEnv'..."

  case "$suite" in
    smoke) testOptions=(--fgrep @smoke-test) ;;
    all)   testOptions=() ;;
    *) log "!!! Error: unrecongised test suite: $suite"; exit 1 ;;
  esac

  NODE_CONFIG_ENV="$configEnv" node lib/bin/s3-create-bucket.js

  serverPort="$(NODE_CONFIG_ENV="$configEnv" node -e 'console.log(require("config").default.server.port)')"
  serverUrl="http://localhost:$serverPort"
  if curl -s -o /dev/null $serverUrl; then
    log "!!! Error: server already running at: $serverUrl"
    exit 1
  fi

  NODE_CONFIG_ENV="$configEnv" make run &
  serverPid=$!

  log 'Waiting for backend to start...'
  timeout 30 bash -c "while ! curl -s -o /dev/null $serverUrl; do sleep 1; done"
  log 'Backend started!'

  cd test/e2e/s3
  NODE_CONFIG_ENV="$configEnv" NODE_CONFIG_DIR=../../../config npx mocha "${testOptions[@]}" test.js
  cd -

  if ! curl -s -o /dev/null "$serverUrl"; then
    log '!!! Backend died.'
    exit 1
  fi

  log "Suite '$suite' with config '$configEnv' completed OK."
}

# TODO consider if this will be simpler with explicit config declaration here, e.g. NODE_CONFIG="{...}"
# TODO consider if this will be simpler with explicit mocha options declared here, e.g. (--fgrep @smoke-test)
NODE_CONFIG='{ "default":{ "server":{ "port":8384 } "external":{ "s3blobStore":{ "region":"" } } } }' \
run_suite smoke

NODE_CONFIG='{ "default":{ "server":{ "port":8385 } "external":{ "s3blobStore":{ "region":"ijijij3ofij4ofjoi4jf534ijfo534ijf34oijfo43ijf4o3ijfo43ijfo34ijfoi34jfo43ijfo43ijo34ifjo34ifj                     what" } } } }' \
run_suite smoke

run_suite all

log "Tests completed OK."
