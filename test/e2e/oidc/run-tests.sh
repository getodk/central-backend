#!/bin/bash -eu

log() {
  echo "[oidc-tester] $*"
}

if [[ "${CI-}" = true ]]; then
  log "Configuring DNS..."
  # N.B. configuring DNS is done at runtime because Docker prevents write access before then.
  echo '127.0.0.1 fake-oidc-server.example.net' | sudo tee --append /etc/hosts
  echo '127.0.0.1      odk-central.example.org' | sudo tee --append /etc/hosts
  log "DNS configured."

  log "Starting services..."
  (cd test/e2e/oidc/fake-oidc-server && npm ci && node index.js) &
  (NODE_TLS_REJECT_UNAUTHORIZED=0 node lib/bin/run-server.js) &
else
  log "!!! WARN: skipping DNS configuration!"
  log "!!! WARN: You may need to manually edit you /etc/hosts file."
fi

log "Waiting for fake-oidc-server to start..."
wait-for-it localhost:9898 --strict --timeout=60 -- echo '[oidc-tester] fake-oidc-server is UP!'

log "Waiting for odk-central-backend to start..."
wait-for-it localhost:8383 --strict --timeout=60 -- echo '[oidc-tester] odk-central-backend is UP!'

log "Creating test users..." # _after_ migrations have been run
node lib/bin/cli.js --email alice@example.com user-create
log "Test users created."

log "Running playwright tests..."
cd test/e2e/oidc/playwright-tests
npx playwright test

log "Tests completed OK!"
