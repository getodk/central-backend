#!/bin/bash -eu
set -o pipefail

log() { echo >&2 "[test/e2e/soak/$(basename "$0" .sh)] $*"; }

pg_exec() {
  PGPASSWORD=odktest \
  psql \
      --host=localhost \
      --username=postgres \
      --quiet \
      --tuples-only \
      --no-align \
      --command="$1"
}

# Allow longer queries to be captured in the pg_stat_activity table.
# Default length stored is 1KB, after which the query is truncted.
log "Increasing query log lengths..."

log "  track_activity_query_size (initial): $(pg_exec 'SHOW track_activity_query_size')"
pg_exec "ALTER SYSTEM SET track_activity_query_size = 16384"

# Postgres must be restarted to apply change to track_activity_query_size
# See: https://www.postgresql.org/docs/14/runtime-config-statistics.html#GUC-TRACK-ACTIVITY-QUERY-SIZE
log "  Restarting postgres..."
pgImg="$(docker ps -q --filter name=postgres)"
docker restart "$pgImg" >/dev/null
timeout 10 bash -c "while ! docker exec $pgImg pg_isready --timeout=1; do sleep 1; done"
log "  Restarted OK."

finalQuerySize="$(pg_exec 'SHOW track_activity_query_size')"
log "  track_activity_query_size (final): $finalQuerySize"

expectedFinalQuerySize=16kB
if [[ $finalQuerySize != $expectedFinalQuerySize ]]; then
  log "!!!"
  log "!!! Failed to set final query size."
  log "!!!"
  log "!!!   expected: $expectedFinalQuerySize"
  log "!!!     actual: $finalQuerySize"
  log "!!!"
  exit 1
fi

log "DONE."
