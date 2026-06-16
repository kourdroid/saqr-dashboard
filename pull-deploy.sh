#!/bin/bash
set -e

IMAGE="ghcr.io/kourdroid/saqr-dashboard:latest"
ENV_FILE="/root/saqr-dashboard/.ghcr-pat"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found. Create it with: echo 'ghp_xxx' > $ENV_FILE && chmod 600 $ENV_FILE"
  exit 1
fi

GHCR_PAT=$(cat "$ENV_FILE" | tr -d '\n')

echo "$GHCR_PAT" | docker login ghcr.io -u kourdroid --password-stdin

echo "Pulling $IMAGE..."
docker pull "$IMAGE"

systemctl stop saqr-dashboard 2>/dev/null || true
systemctl disable saqr-dashboard 2>/dev/null || true

docker compose -f /root/docker-compose.yml up -d saqr

docker image prune -f
docker logout ghcr.io

echo "Pull-deploy complete at $(date)"
