#!/bin/bash
set -e
cd /root/saqr-dashboard
git pull origin main 2>&1
cd frontend
npm run build 2>&1
cd ..
systemctl restart saqr-dashboard 2>&1
echo "Deploy complete"
