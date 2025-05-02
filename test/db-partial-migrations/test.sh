#!/bin/bash -eux
set -o pipefail

log() { echo "[test/db-partial-migrations/prepare] $*"; }

if ! [[ "$(git status --porcelain)" = "" ]]; then
  log "!!!"
  log "!!! You have uncomitted changes in your local git repo."
  log "!!!"
  log "!!! This command will make destructive changes."
  log "!!!"
  log "!!! Please revert or commit these changes before continuing."
  log "!!!"
  exit 1
fi

show_migrations() {
  tree lib/model/migrations # TODO reinstate
}

prerun="$1"
log "Requested for prerun: $prerun"

migrations_legacy=./lib/model/migrations/legacy
migrations_new=./lib/model/migrations

rmExceptFirst() {
  local skipCount="$1"
  local src="$2"
  find "$src" -maxdepth 1 -type f -name \*.js -printf '%p\n' |
      sort |
      tail -n +$((skipCount+1)) |
      xargs rm
}

log "Re-arranging migrations..."
case "$prerun" in
  none)
    rm "$migrations_new"/*.js
    rm "$migrations_legacy"/*.js
    ;;
  legacy-all)
    rm "$migrations_new"/*.js
    mv "$migrations_legacy"/*.js "$migrations_new/"
    ;;
  legacy-first-*)
    rm "$migrations_new"/*.js
    rmExceptFirst "$(sed s/legacy-first-// <<<"$prerun")" "$migrations_legacy"
    mv "$migrations_legacy"/*.js "$migrations_new/"
    ;;
  new-first-*-as-legacy)
    rmExceptFirst "$(sed "s/new-first-\(.*\)-as-legacy/\1/" <<<"$prerun")" "$migrations_new"
    sed -E -i -e "s/db\.query/db.raw/" -- "$migrations_new"/*.js
    mv "$migrations_legacy"/*.js "$migrations_new/"
    ;;
  all)
    sed -E -i -e "s/db\.query/db.raw/" -- "$migrations_new"/*.js
    mv "$migrations_legacy"/*.js "$migrations_new/"
    ;;
  *)
    log "!!!"
    log "!!! No rule found matching '$prerun'"
    log "!!!"
    exit 1
    ;;
esac
log "Initial migrations structure:"
show_migrations

log "Running legacy migrations..."
make migrations-legacy

log "Re-instating unrun migrations..."
git checkout   -- lib/model/migrations
git clean -dfx -- lib/model/migrations

log "Final migrations structure:"
show_migrations

log "Running modern migrations..."
make migrations

log "Checking final database schema..."
if ! diff test/db-partial-migrations/expected-schema.sql <(./test/db-partial-migrations/dump-postgres-schema); then
  log "!!!"
  log "!!! Schema differences detected.  See above for details."
  log "!!!"
  exit 1
fi

log "Completed OK."
