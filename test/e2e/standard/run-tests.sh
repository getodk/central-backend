#!/bin/bash -eu
set -o pipefail

serverUrl="http://localhost:8383"
userEmail="x@example.com"
userPassword="secret1234"

log() { echo "[test/e2e/standard/run-tests] $*"; }

log "Building backend..."
make base

log "Attempting to create user..."
echo "$userPassword" | node ./lib/bin/cli.js user-create  -u "$userEmail" && log "User created."
log "Attempting to promote user..."
node ./lib/bin/cli.js user-promote -u "$userEmail" && log "User promoted."

kill_child_processes() {
  log "Killing child processes..."
  kill -- -$$ || true
}
trap kill_child_processes EXIT

log "Starting backend..."
make run | tee server.log &

log "Waiting for backend to start..."
timeout 30 bash -c "while ! curl -s -o /dev/null $serverUrl; do sleep 1; done"
log "Backend started!"

cd test/e2e/standard
npx mocha test.js

if ! curl -s -o /dev/null "$serverUrl"; then
  log "Backend died."
  exit 1
fi

log "Test completed OK."
