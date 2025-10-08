#!/usr/bin/env bash
set -o errexit

apt-get update
apt-get install -y google-chrome-stable

npm install
# npm run build   # if needed
