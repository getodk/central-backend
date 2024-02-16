#!/bin/bash -eu

log() {
  echo "[oidc-tester] $*"
}

export NODE_CONFIG_ENV=oidc-e2e

if [[ "${CI-}" = true ]]; then
  log "Configuring DNS..."
  # N.B. configuring DNS is done at runtime because Docker prevents write access before then.
  echo '127.0.0.1 fake-oidc-server.example.net' | sudo tee --append /etc/hosts
  echo '127.0.0.1      odk-central.example.org' | sudo tee --append /etc/hosts

  log "Installing apt dependencies..."
  sudo apt-get install -y wait-for-it

  log "Creating database users..."
  npm ci --legacy-peer-deps
  node lib/bin/create-docker-databases.js

  START_SERVICES=true
fi

if [[ ${START_SERVICES-} = true ]]; then
  log "Starting background services..."
  (make fake-oidc-server-ci) &
  (NODE_TLS_REJECT_UNAUTHORIZED=0 make run) &
else
  log "Skipping service startup.  Set START_SERVICES=true for managed services."
fi

log "Waiting for fake-oidc-server to start..."
wait-for-it localhost:9898 --strict --timeout=60 -- echo '[oidc-tester] fake-oidc-server is UP!'

log "Waiting for odk-central-backend to start..."
wait-for-it localhost:8383 --strict --timeout=60 -- echo '[oidc-tester] odk-central-backend is UP!'

if ! [[ "${CREATE_USERS-}" = false ]]; then
  log "Creating test users..."
  node lib/bin/cli.js --email alice@example.com user-create
  log "Test users created."
fi

cd test/e2e/oidc/playwright-tests
log "Playwright: $(npx playwright --version)"
log "Installing playwright deps..."
npx playwright install --with-deps
log "Running playwright tests..."
npx playwright test

log "Tests completed OK!"
