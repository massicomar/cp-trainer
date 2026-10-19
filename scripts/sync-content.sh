#!/bin/sh
# Runs on the VPS. Called over SSH by cp-trainer-content's deploy workflow; safe to run by hand.
# Pulls the content repo and syncs it into the running app. A sync that fails
# validation leaves the database unchanged and exits non-zero.
set -eu
cd "$(dirname "$0")/.."

git -C "${CONTENT_PATH:-../cp-trainer-content}" pull --ff-only
docker compose exec -T app node ace content:sync
