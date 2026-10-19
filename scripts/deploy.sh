#!/bin/sh
# Runs on the VPS. Called over SSH by .github/workflows/deploy.yml; safe to run by hand.
set -eu
cd "$(dirname "$0")/.."

git pull --ff-only
docker compose up -d --build --remove-orphans
docker image prune -f

# Wait for the container healthcheck (GET /health) so a broken release fails the workflow.
container=$(docker compose ps -q app)
for _ in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$container")
  if [ "$status" = healthy ]; then
    echo "app is healthy"
    exit 0
  fi
  sleep 2
done

echo "app did not become healthy (last status: $status)" >&2
docker compose logs --tail 50 app >&2
exit 1
