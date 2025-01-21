#!/bin/bash -eu
set -o pipefail

serverUrl=http://localhost:8383

log() {
  if [[ ${testname-} = "" ]]; then
    echo "[test/e2e/standard/backup-restore] $*"
  else
    echo "[test/e2e/standard/backup-restore] [$testname] $*"
  fi
}

backup() {
  local contentType="$1"
  local postBody="$2"

  backupDir="$(mktemp --directory)"
  cd "$backupDir"
  
  target="backup.zip"
  creds="$(echo -n 'x@example.com:secret1234' | base64)"
  wget \
      --header "X-Forwarded-Proto: https" \
      --header "Content-Type: $contentType" \
      --header="Authorization: Basic $creds" \
      "$serverUrl/v1/backup" \
      --post-data "$postBody" \
      -O "$target"
  cd -
}

if ! curl -s -o /dev/null "$serverUrl"; then
  log "Backend is not running - cannot run tests."
  exit 1
fi

testname=no-passphrase
log "Testing with no passphrase supplied for backup..."
backup text/plain ''
log "  Restoring with no passphrase..."
node ./lib/bin/restore.js "$backupDir/$target"
log "  Restoring with explicit empty passphrase..."
node ./lib/bin/restore.js "$backupDir/$target" ""
log "  Restoring with incorrect passphrase..."
if node ./lib/bin/restore.js "$backupDir/$target" "wrong-passphrase"; then
  log "    Incorrect passphrase should have been rejected."
  exit 1
fi

testname=empty-passphrase
log "Testing with empty passphrase supplied for backup..."
backup application/json '{"passphrase":""}'
log "  Restoring with no passphrase..."
node ./lib/bin/restore.js "$backupDir/$target"
log "  Restoring with explicit empty passphrase..."
node ./lib/bin/restore.js "$backupDir/$target" ""
log "  Restoring with incorrect passphrase..."
if node ./lib/bin/restore.js "$backupDir/$target" "wrong-passphrase"; then
  log "    Incorrect passphrase should have been rejected."
  exit 1
fi

testname=with-passphrase
log "Testing with explicit passphrase supplied for backup..."
backup application/json '{"passphrase":"megasecret"}'
log "  Restoring with correct passphrase..."
node ./lib/bin/restore.js "$backupDir/$target" megasecret
log "  Restoring without passphrase..."
if node ./lib/bin/restore.js "$backupDir/$target"; then
  log "    Missing passphrase should have been rejected."
  exit 1
fi
log "  Restoring with empty passphrase..."
if node ./lib/bin/restore.js "$backupDir/$target" ""; then
  log "    Empty passphrase should have been rejected."
  exit 1
fi
log "  Restoring with incorrect passphrase..."
if node ./lib/bin/restore.js "$backupDir/$target" "wrong-passphrase"; then
  log "    Incorrect passphrase should have been rejected."
  exit 1
fi

testname=

log "All checks passed OK."
