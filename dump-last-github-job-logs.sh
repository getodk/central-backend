#!/bin/bash -eu
log() { echo >&2 "[$(basename "$0")] $*"; }

runId=$(gh run list --branch $(git branch --show-current) --limit 1 --json databaseId --jq '.[0].databaseId')
log "run id: $runId"

logDir="gha-logs/$runId"
log "log dir: $logDir"

if [[ -d "$logDir" ]]; then
  log "It looks like you already got the latest logs."
  exit
fi

mkdir -p "$logDir"

gh run view "$runId" --json jobs --jq '.jobs[] | "\(.databaseId) \(.name)"' | while read -r jobId jobName; do
  safeName="$(echo "$jobName" | sed 's/[ /]/_/g')"
  log "fetching logs for: $jobName..."
  gh run view --job "$jobId" --log > "gha-logs/$runId/$safeName.log"
done

log "All done."
