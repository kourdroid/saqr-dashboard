#!/bin/bash
set -e

IMAGE="ghcr.io/kourdroid/saqr-dashboard:latest"

if [ -z "$GHCR_PAT" ]; then
  echo "Error: GHCR_PAT not set. Run: export GHCR_PAT=ghp_xxx"
  exit 1
fi

echo "$GHCR_PAT" | docker login ghcr.io -u kourdroid --password-stdin

echo "Pulling $IMAGE..."
docker pull "$IMAGE"

echo "Stopping old systemd service..."
systemctl stop saqr-dashboard 2>/dev/null || true
systemctl disable saqr-dashboard 2>/dev/null || true

echo "Recreating saqr service..."
docker compose -f /root/docker-compose.yml up -d saqr

echo "Cleaning up old images..."
docker image prune -f

echo "Deploy complete at $(date)"
