#!/bin/bash -eux
set -o pipefail
shopt -s inherit_errexit

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
  tree lib/model/migrations
  sleep 1 # wait for output to flush - seems slow in CI
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

fixLegacyMigrations() {
  # fix relative require() paths
  sed -E -i -e "s:\.\./\.\./:../:" -- "$migrations_legacy"/*.js
  mv "$migrations_legacy"/*.js "$migrations_new/"
}

fixNewMigrations() {
  # convert pg API to knex API
  sed -E -i -e "s/db\.query/db.raw/" -- "$migrations_new"/*.js
}

log "Re-arranging migrations..."
case "$prerun" in
  none)
    rm "$migrations_new"/*.js
    rm "$migrations_legacy"/*.js
    ;;
  legacy-all)
    rm "$migrations_new"/*.js
    fixLegacyMigrations
    ;;
  legacy-first-*)
    rm "$migrations_new"/*.js
    rmExceptFirst "$(sed s/legacy-first-// <<<"$prerun")" "$migrations_legacy"
    fixLegacyMigrations
    ;;
  new-first-*-as-legacy)
    rmExceptFirst "$(sed "s/new-first-\(.*\)-as-legacy/\1/" <<<"$prerun")" "$migrations_new"
    fixNewMigrations
    fixLegacyMigrations
    ;;
  all)
    fixNewMigrations
    fixLegacyMigrations
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
DEBUG="knex:*" make migrations-legacy

log "Re-instating unrun migrations..."
git checkout   -- lib/model/migrations
git clean -dfx -- lib/model/migrations

log "Final migrations structure:"
show_migrations

log "Running modern migrations..."
make migrations

pgConnectionString="$(node -e '
  const { host, database, user, password } = require("config").get("default.database");
  console.log(`postgres://${user}:${password}@${host}/${database}`);
')"

log "Checking final database schema..."
if ! diff \
    test/db-partial-migrations/expected-schema.sql \
    <(pg_dump --schema-only "$pgConnectionString"); then
  log "!!!"
  log "!!! Schema differences detected.  See above for details."
  log "!!!"
  exit 1
fi

log "Checking migrations table..."
tableName="knex_migrations"
if ! diff \
    test/db-partial-migrations/expected-migrations-table-contents.sql \
    <(psql "$pgConnectionString" -c "SELECT id, name FROM $tableName"); then
  log "!!!"
  log "!!! $tableName table content differences detected.  See above for details."
  log "!!!"
  exit 1
fi

log "Completed OK."
