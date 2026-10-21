#!/bin/sh
# Runs on the VPS from cron (see docs/deploy.md, "Backups"). Safe to run by hand.
# Writes a copy of the database to ./backups and deletes copies older than 14 days.
set -eu
cd "$(dirname "$0")/.."

docker compose exec -T app node ace db:backup
