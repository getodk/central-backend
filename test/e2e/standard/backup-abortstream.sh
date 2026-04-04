#!/bin/bash -eu
set -o pipefail

serverUrl=http://127.0.0.1:8383
HTTP_AUTH='x@example.com:secret1234'

log() {
    echo "[test/e2e/standard/backup-abortstream] $*"
}

if ! curl -s --out-null "$serverUrl"; then
  log "Backend is not running - cannot run tests."
  exit 1
fi

log "Testing whether an aborted stream is detectable"
set +e

curl \
--request POST \
--compressed `# accepting compression should not result in removing the chunking, we rely on it` \
--header "X-Forwarded-Proto: https" \
--verbose \
--silent --header "Accept: */*" \
--out-null \
--user ${HTTP_AUTH} \
"${serverUrl}/v1/backup"

curl_exitcode=${?}
set -e
if [ $curl_exitcode -ne 18 ]; then
  log "    Crashed stream production should have been detected (with curl exitcode 18: \"Partial file. Only a part of the file was transferred.\")"
  exit 1
fi

log "All checks passed OK."
