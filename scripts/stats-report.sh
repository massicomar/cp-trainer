#!/bin/sh
# Builds the visits report (/_stats/) from Caddy's access log with GoAccess (D-101).
# On the VPS, cron runs it every hour (see docs/deploy.md, "Analytics"). Safe to run by hand.
#
#   scripts/stats-report.sh [LOG_DIR] [OUT_DIR]
#
#   LOG_DIR  folder with cp-trainer.log and its rotated copies (default: /root/sites/caddy/logs)
#   OUT_DIR  folder for index.html and GoAccess's database   (default: /root/sites/caddy/stats/cp-trainer)
#
# Locally, after `docker compose --profile local up`:  scripts/stats-report.sh ./logs ./stats/cp-trainer
#
# GoAccess keeps its totals in OUT_DIR/db and remembers how far it read each
# file, so every run only adds new lines. Rotated files are passed oldest
# first: Caddy keeps them uncompressed (roll_uncompressed), so a renamed file is
# still the one GoAccess was reading and its last lines aren't lost.
set -eu

GOACCESS_IMAGE=allinurl/goaccess:1.12

LOG_DIR=${1:-/root/sites/caddy/logs}
OUT_DIR=${2:-/root/sites/caddy/stats/cp-trainer}

if [ ! -d "$LOG_DIR" ]; then
  echo "no log folder at $LOG_DIR" >&2
  exit 1
fi
LOG_DIR=$(cd "$LOG_DIR" && pwd)
mkdir -p "$OUT_DIR/db"
OUT_DIR=$(cd "$OUT_DIR" && pwd)

# Rotated copies are named cp-trainer-<time>.log, which sorts before cp-trainer.log.
FILES=""
for file in "$LOG_DIR"/cp-trainer-*.log "$LOG_DIR"/cp-trainer.log; do
  if [ -s "$file" ]; then
    FILES="$FILES /logs/$(basename "$file")"
  fi
done

if [ -z "$FILES" ]; then
  echo "$(date -u +%FT%TZ) no access log yet in $LOG_DIR"
  exit 0
fi

# $FILES is split on purpose: one argument per log file (the names have no spaces).
# shellcheck disable=SC2086
docker run --rm \
  -v "$LOG_DIR":/logs:ro \
  -v "$OUT_DIR":/out \
  "$GOACCESS_IMAGE" \
  $FILES \
  --log-format=CADDY \
  --persist --restore --db-path=/out/db \
  --anonymize-ip \
  --ignore-crawlers \
  --ignore-statics=req \
  --html-report-title="CP Trainer · visitas" \
  --output=/out/index.html

echo "$(date -u +%FT%TZ) report written to $OUT_DIR/index.html"
