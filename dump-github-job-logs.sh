#!/bin/bash -eu
log() { echo >&2 "[$(basename "$0")] $*"; }

if [[ $# -gt 0 ]] && [[ $1 = --help ]]; then
  cat <<EOF
    USAGE
      $(basename "$0") [--force] [run-id]
EOF
  exit
fi

forceDownload=
if [[ $# -gt 0 ]] && [[ $1 = --force ]]; then
  forceDownload=true
  shift
fi

if [[ $# -gt 0 ]]; then
  runId="$1"
  shift
else
  log "--- runs in progress: ---"
  gh run list  --branch "$(git branch --show-current)" --status in_progress --json headBranch,headSha,displayTitle,url --jq '.[] | "* \(.headBranch) \(.headSha[0:7]) \"\(.displayTitle)\": \(.url)"'
  log "-------------------------"

  log "Fetching last COMPLETED run id..."
  runId="$(gh run list --branch "$(git branch --show-current)" --limit 1 --status completed --json databaseId --jq '.[0].databaseId')"
fi

# Protect against injected run IDs.  With --force, e.g. runId=/../.. could cause some problems.
if ! [[ $runId =~ ^[0-9]+$ ]]; then
  log "Invalid run id: $runId"
  exit 1
fi
log "run id: $runId"

parentDir="gha-logs/run-$runId"
if [[ $forceDownload = true ]] && [[ -d "$parentDir" ]]; then
  log "Cleaning existing logs from $parentDir ..."
  rm -rf ./$parentDir
fi

attempts="$(gh run view "$runId" --json attempt --jq .attempt)"
log "attempts: $attempts"

for ((attemptIdx=1; attemptIdx<=$attempts; ++attemptIdx)); do
  logDir="$parentDir/attempt-$attemptIdx"
  log "log dir: $logDir"

  if [[ -d "$logDir" ]]; then
    log "  It looks like you already got the logs for this attempt."
    continue
  fi

  mkdir -p "$logDir"

  log "Fetching logs for FAILED jobs..."
  gh run view "$runId" \
      --attempt "$attemptIdx" \
      --json jobs \
      --jq '.jobs[] | select(.conclusion=="failure") | "\(.databaseId) \(.name)"' |
  while read -r jobId jobName; do
    safeName="$(echo "$jobName" | sed 's/[ /]/_/g')"
    log "fetching logs for: $jobName..."
    gh run view --job "$jobId" --attempt "$attemptIdx" --log > "$logDir/$safeName.log"
  done
done


log "All done."
