#!/usr/bin/env bash
# update-bot.sh — pull latest from GitHub and restart the bot.
# Paste into SSH and run:  bash ~/update-bot.sh

set -euo pipefail

# ===== EDIT THIS =====
REPO_URL="https://github.com/karandeepmalik/fip-bot.git"   # your repo URL
BRANCH="main"                                          # branch to track
# ======================

APP_DIR="$HOME/fip-bot"
ENTRY="fip-warriors-bot.mjs"
APP_NAME="fip-bot"

echo "==> [1/3] Fetch latest code"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin
  git reset --hard "origin/$BRANCH"
  echo "    pulled latest from origin/$BRANCH"
else
  # first run — clone, but preserve auth_info if it exists
  if [ -d "$APP_DIR/auth_info" ]; then
    mv "$APP_DIR/auth_info" /tmp/_auth_info_backup
  fi
  rm -rf "$APP_DIR"
  git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
  if [ -d /tmp/_auth_info_backup ]; then
    mv /tmp/_auth_info_backup "$APP_DIR/auth_info"
    echo "    restored auth_info from backup"
  fi
fi

echo "==> [2/3] Install dependencies"
npm install

echo "==> [3/3] Restart bot"
pm2 restart "$APP_NAME" --update-env 2>/dev/null \
  || pm2 start "$ENTRY" --name "$APP_NAME" --time
pm2 save

echo
echo "Done. Check: pm2 logs $APP_NAME --lines 30"
