#!/usr/bin/env bash
set -e
set -u
set -o pipefail

log() { echo >&2 "[docker-postgres] $*"; }

imageName=odk-central-backend-dev-postgres
PG_VERSION="${PG_VERSION-14}"

enableSsl=
if [[ "${1-}" = --ssl ]]; then
  imageName="$imageName-ssl"
  enableSsl=true
  shift
fi

usage() {
  exitCode="${1-1}"
  cat <<EOF
    $0 [--ssl] [--help|start|stop|remove]
EOF
  exit "$exitCode"
}

if [[ $# -lt 1 ]]; then
  usage 1
fi

case "$1" in
  remove) docker rm   "$imageName" || true; exit ;;
  stop)   docker stop "$imageName" || true; exit ;;
  start)  ;; # continue script
  *)      usage 1 ;;
esac

if [[ "$enableSsl" = true ]]; then
  log "Setting up any missing SSL certs..."

  mkdir -p .pg-certs
  (
    cd .pg-certs

    [[ -s ca.key     ]] || openssl genrsa -out     ca.key 2048
    [[ -s not-ca.key ]] || openssl genrsa -out not-ca.key 2048
    [[ -s ca.crt     ]] || openssl req -x509 -new -nodes -key     ca.key -sha256 -days 1 -out     ca.crt -subj "/CN=TestCA"
    [[ -s not-ca.crt ]] || openssl req -x509 -new -nodes -key not-ca.key -sha256 -days 1 -out not-ca.crt -subj "/CN=NotTestCA"
    [[ -s server.key ]] || openssl genrsa -out server.key 2048
    [[ -s server.csr ]] || openssl req -new -key server.key -out server.csr -subj "/CN=localhost"
    [[ -s server.crt ]] || openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
                                        -out server.crt -days 1 -sha256 -extfile \
                           <(printf "subjectAltName=DNS:localhost,IP:127.0.0.1")
  )

  log "Changing cert ownership; this may require sudo password..."
  sudo chown -R 999:999 .pg-certs
  sudo -k

  log "SSL certs setup completed OK."
fi

log "Attempting to start existing container..."
if docker start "$imageName"; then
  log "(Re)started OK."
  exit
fi
log "Failed to start existing container."

log "Starting fresh container..."
docker run \
    --detach \
    --name "$imageName" \
    --publish 127.0.0.1:5432:5432 \
    --env POSTGRES_PASSWORD=odktest \
    ${enableSsl:+"--volume" "$PWD"/.pg-certs:/postgres-certs} \
    postgres:"$PG_VERSION" \
        --shared_preload_libraries=pg_stat_statements \
        ${enableSsl:+--ssl=on} \
        ${enableSsl:+--ssl_cert_file=/postgres-certs/server.crt} \
        ${enableSsl:+--ssl_key_file=/postgres-certs/server.key}

wait_for_postgres() {
  printf >&2 "[docker-postgres] Waiting for postgres..."
  maxTries=15
  retries=$((maxTries-1))
  while ! docker exec "$imageName" psql -U postgres -c 'SELECT 1' >/dev/null 2>&1; do
    if [[ "$retries" = 0 ]]; then
      log "!!! Failed: image '$imageName' not available after $maxTries attempts."
      exit 1
    fi
    printf >&2 .
    sleep 1
    retries=$((retries-1))
  done
  printf >&2 'OK.\n'
}
wait_for_postgres

node lib/bin/create-docker-databases.js ${CI:+--log}

if [[ "$enableSsl" = true ]]; then
  docker exec "$imageName" bash -c 'sed -i "s/^host\b/hostssl/" "$PGDATA/pg_hba.conf"'
  docker exec "$imageName" psql -U postgres -c 'SELECT pg_reload_conf();'
  wait_for_postgres
fi

log "Fresh container started OK."
