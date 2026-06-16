#!/bin/bash
set -e
cd /root/saqr-dashboard

# Push any local changes to GitHub first
if [[ -n $(git status --porcelain) ]]; then
    git add -A
    git commit -m "Auto-sync: $(date -u '+%Y-%m-%d %H:%M UTC')" || true
fi
git push origin main 2>&1

# Pull latest from GitHub
git pull origin main 2>&1

# Rebuild frontend
cd frontend
npm run build 2>&1
cd ..

# Restart service
systemctl restart saqr-dashboard 2>&1
echo "Deploy complete"
