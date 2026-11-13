#!/usr/bin/env bash
# Runs on the server (piped in by deploy.bat with the project folder under $HOME and the container name as arguments). Replaces the source but keeps .env, docker-compose.yml and data/,
# which hold the server's own settings, secrets and saved data.
set -euo pipefail

DIR="$HOME/${1:-docker/odeon}"
CONTAINER="${2:-odeon}"
ARCHIVE=/tmp/odeon-src.tar.gz

[ -f "$ARCHIVE" ] || { echo "No uploaded archive at $ARCHIVE" >&2; exit 1; }
[ -f "$DIR/.env" ] && [ -f "$DIR/docker-compose.yml" ] || { echo "$DIR is not set up yet (missing .env or docker-compose.yml)" >&2; exit 1; }

# Check the archive before deleting anything.
tar -tzf "$ARCHIVE" >/dev/null
find "$DIR" -mindepth 1 -maxdepth 1 ! -name .env ! -name docker-compose.yml ! -name data -exec rm -rf {} +
tar -xzf "$ARCHIVE" -C "$DIR"
rm -f "$ARCHIVE"

cd "$DIR"
echo "Building and restarting (if the build fails, the running version stays up)..."
docker compose up -d --build 2>&1 | grep -vE '^#[0-9]+ (\[|sha256|extracting|transferring|resolve|CACHED)' | tail -15

for i in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null)" = healthy ] && break
  sleep 2
done
docker ps --filter "name=$CONTAINER" --format '{{.Names}} | {{.Status}} | {{.Ports}}'
docker image prune -f >/dev/null
