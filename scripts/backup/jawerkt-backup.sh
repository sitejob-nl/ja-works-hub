#!/bin/bash
# Dagelijkse backup van het JA Werkt-platform (Supabase) naar de Hetzner Storage Box.
#
# Twee fasen, onafhankelijk van elkaar:
#   1. database  — pg_dump van de Supabase-database (altijd; harde fout als dit misgaat)
#   2. storage   — spiegel van de Supabase Storage-buckets (alleen als er S3-sleutels zijn)
#
# Beide fasen landen in dezelfde versleutelde borg-repo, zodat borg over opeenvolgende
# dagen dedupliceert. De dump gaat er ONGECOMPRIMEERD in: borg comprimeert zelf en
# dedupliceert veel beter op onbewerkte data.
#
# Spiegelt bewust /usr/local/bin/backup-srv1.sh (zelfde borg-patroon, zelfde Storage Box).
# Alle instellingen staan in /var/lib/jawerkt-backup/backup.env (mode 600, root).
#
# Installatie: zie scripts/backup/README.md
set -euo pipefail

CONF=${JAWERKT_BACKUP_CONF:-/var/lib/jawerkt-backup/backup.env}
WORKDIR=$(dirname "$CONF")
STATUS="$WORKDIR/status.json"
DUMPDIR="$WORKDIR/db"
STORAGEDIR="$WORKDIR/storage"
TRASHDIR="$WORKDIR/storage-verwijderd"
LOG=/var/log/jawerkt-backup.log

START_EPOCH=$(date +%s)
STAMP=$(date +%Y-%m-%d_%H%M%S)
DB_STATUS=overgeslagen
STORAGE_STATUS=overgeslagen
DB_BYTES=0
STORAGE_OBJECTS=0
CHECKIN_ID=""

log() { printf '%s  %s\n' "$(date -Is)" "$*" | tee -a "$LOG"; }

if [ ! -r "$CONF" ]; then
    echo "FOUT: configuratie ontbreekt of is onleesbaar: $CONF" >&2
    exit 78 # EX_CONFIG
fi
# shellcheck source=/dev/null
. "$CONF"

: "${PGHOST:?PGHOST ontbreekt in $CONF}"
: "${PGUSER:?PGUSER ontbreekt in $CONF}"
: "${PGPASSFILE:?PGPASSFILE ontbreekt in $CONF}"
: "${BORG_REPO:?BORG_REPO ontbreekt in $CONF}"

export PGHOST PGPORT="${PGPORT:-5432}" PGUSER PGDATABASE="${PGDATABASE:-postgres}" PGPASSFILE
export BORG_REPO BORG_PASSCOMMAND BORG_RSH

mkdir -p "$DUMPDIR" "$STORAGEDIR" "$TRASHDIR"
chmod 700 "$WORKDIR" "$DUMPDIR" "$STORAGEDIR" "$TRASHDIR"

# Lock vóór de EXIT-trap: een overgeslagen run mag géén "ok" naar Sentry sturen,
# anders meldt een vastgelopen backup zichzelf elke nacht gezond.
exec 9>/var/lock/jawerkt-backup.lock
if ! flock -n 9; then
    log "vorige run draait nog — overgeslagen"
    exit 0
fi

# ─── Sentry cron check-in ────────────────────────────────────────────────────
# Losse curl-implementatie van het envelope-protocol; identiek aan wat
# supabase/functions/_shared/sentry.ts doet. Ontbreekt de DSN, dan gebeurt er niets.
sentry_checkin() {
    local status=$1 duration=${2:-} monitor=${SENTRY_MONITOR_SLUG:-jawerkt-backup}
    [ -n "${SENTRY_DSN_EDGE:-}" ] || return 0

    local key host project url payload item envelope
    key=$(printf '%s' "$SENTRY_DSN_EDGE" | sed -E 's#^https://([^@]+)@.*#\1#')
    host=$(printf '%s' "$SENTRY_DSN_EDGE" | sed -E 's#^https://[^@]+@([^/]+)/.*#\1#')
    project=$(printf '%s' "$SENTRY_DSN_EDGE" | sed -E 's#.*/([0-9]+)$#\1#')
    [ -n "$key" ] && [ -n "$host" ] && [ -n "$project" ] || return 0
    url="https://${host}/api/${project}/envelope/"

    [ -n "$CHECKIN_ID" ] || CHECKIN_ID=$(cat /proc/sys/kernel/random/uuid | tr -d -)

    if [ "$status" = in_progress ]; then
        payload=$(printf '{"check_in_id":"%s","monitor_slug":"%s","status":"%s","environment":"production","monitor_config":{"schedule":{"type":"crontab","value":"%s"},"timezone":"UTC","checkin_margin":30,"max_runtime":120}}' \
            "$CHECKIN_ID" "$monitor" "$status" "${SENTRY_MONITOR_SCHEDULE:-20 4 * * *}")
    else
        payload=$(printf '{"check_in_id":"%s","monitor_slug":"%s","status":"%s","environment":"production","duration":%s}' \
            "$CHECKIN_ID" "$monitor" "$status" "${duration:-0}")
    fi

    item=$(printf '{"type":"check_in","length":%s}' "$(printf '%s' "$payload" | wc -c)")
    envelope=$(printf '{"event_id":"%s"}\n%s\n%s\n' "$(cat /proc/sys/kernel/random/uuid | tr -d -)" "$item" "$payload")

    curl -sS --max-time 10 -X POST "$url" \
        -H 'Content-Type: application/x-sentry-envelope' \
        -H "X-Sentry-Auth: Sentry sentry_version=7, sentry_key=${key}, sentry_client=jawerkt-backup/1.0" \
        --data-binary "$envelope" >/dev/null 2>&1 || true
}

schrijf_status() {
    local exitcode=$1 duur=$(( $(date +%s) - START_EPOCH ))
    cat > "$STATUS" <<EOF
{
  "laatste_run": "$(date -Is)",
  "exitcode": $exitcode,
  "duur_seconden": $duur,
  "database": { "status": "$DB_STATUS", "bytes": $DB_BYTES },
  "storage": { "status": "$STORAGE_STATUS", "objecten": $STORAGE_OBJECTS },
  "borg_archief": "jawerkt-$STAMP"
}
EOF
    chmod 600 "$STATUS"
}

afronden() {
    local code=$?
    local duur=$(( $(date +%s) - START_EPOCH ))
    if [ $code -eq 0 ]; then
        sentry_checkin ok "$duur"
        log "klaar in ${duur}s (database: $DB_STATUS, storage: $STORAGE_STATUS)"
    else
        sentry_checkin error "$duur"
        log "MISLUKT met exitcode $code na ${duur}s"
    fi
    schrijf_status "$code"
}
trap afronden EXIT

# ─── Fase 1: database ────────────────────────────────────────────────────────
dump_database() {
    local doel="$DUMPDIR/jawerkt-$STAMP.dump"
    log "database: pg_dump van $PGHOST"

    # Alleen de schema's met eigen data. Bewust NIET meegenomen:
    #   net + cron  → wegwerptabellen, samen ~41 MB bloat zonder herstelwaarde
    #   vault       → bevat het sleutelmateriaal van de versleutelde kolommen; zie runbook
    #   realtime, extensions, pgsodium, supabase_* → door Supabase beheerd, wordt bij
    #                 het aanmaken van een project opnieuw opgebouwd
    pg_dump --format=custom --compress=0 --no-password \
        --schema=public --schema=auth --schema=storage \
        --file="$doel"

    DB_BYTES=$(stat -c %s "$doel")
    DB_STATUS=ok
    log "database: $doel ($(numfmt --to=iec "$DB_BYTES"))"

    # Alleen de dump van vandaag bewaren op schijf; de historie leeft in borg.
    find "$DUMPDIR" -name 'jawerkt-*.dump' -not -name "jawerkt-$STAMP.dump" -delete
}

# ─── Fase 2: storage-buckets ─────────────────────────────────────────────────
# Supabase' database-backups bevatten NOOIT de bestanden zelf. In de bucket
# 'documents' staan CV's, identiteitsbewijzen en contracten: zonder deze fase
# is dat onherstelbaar.
sync_storage() {
    if [ -z "${STORAGE_S3_ACCESS_KEY:-}" ] || [ -z "${STORAGE_S3_SECRET_KEY:-}" ]; then
        STORAGE_STATUS=niet_geconfigureerd
        log "storage: OVERGESLAGEN — geen S3-sleutels in $CONF (zie README stap 5)"
        return 0
    fi
    if ! command -v rclone >/dev/null; then
        STORAGE_STATUS=rclone_ontbreekt
        log "storage: OVERGESLAGEN — rclone niet geïnstalleerd"
        return 0
    fi

    log "storage: rclone sync van ${STORAGE_S3_ENDPOINT}"
    RCLONE_CONFIG_SB_TYPE=s3 \
    RCLONE_CONFIG_SB_PROVIDER=Other \
    RCLONE_CONFIG_SB_ENDPOINT="$STORAGE_S3_ENDPOINT" \
    RCLONE_CONFIG_SB_REGION="${STORAGE_S3_REGION:-eu-central-1}" \
    RCLONE_CONFIG_SB_ACCESS_KEY_ID="$STORAGE_S3_ACCESS_KEY" \
    RCLONE_CONFIG_SB_SECRET_ACCESS_KEY="$STORAGE_S3_SECRET_KEY" \
        rclone sync sb: "$STORAGEDIR" \
            --backup-dir "$TRASHDIR/$STAMP" \
            --transfers 8 --checkers 16 --retries 3 \
            --stats-one-line --stats 1m \
            --log-file "$LOG" --log-level INFO

    STORAGE_OBJECTS=$(find "$STORAGEDIR" -type f | wc -l)
    STORAGE_STATUS=ok
    log "storage: $STORAGE_OBJECTS objecten gespiegeld"

    # Verwijderde/overschreven bestanden blijven 30 dagen terugvindbaar.
    find "$TRASHDIR" -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
}

# ─── Fase 3: naar de Storage Box ─────────────────────────────────────────────
naar_borg() {
    log "borg: archief jawerkt-$STAMP wegschrijven"
    borg create --compression zstd,6 --stats \
        "::jawerkt-$STAMP" \
        "$DUMPDIR" "$STORAGEDIR"

    # Nooit de laatste backup wegprunen: --keep-daily 14 garandeert dat al.
    borg prune --keep-daily 14 --keep-weekly 8 --keep-monthly 12
    borg compact
}

main() {
    log "=== start backup $STAMP ==="
    sentry_checkin in_progress
    dump_database
    sync_storage
    naar_borg
}

main
