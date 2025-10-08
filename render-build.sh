#!/usr/bin/env bash
# exit on errors
set -o errexit

npm install
npm install puppeteer
# npm run build # uncomment if required

# Store/pull Puppeteer cache with build cache
if [[ "$PUPPETEER_CACHE_DIR" != "$XDG_CACHE_HOME/puppeteer" ]]; then
  if [[ ! -d $PUPPETEER_CACHE_DIR ]]; then 
    echo "...Copying Puppeteer Cache from Build Cache" 
    cp -R $XDG_CACHE_HOME/puppeteer/ $PUPPETEER_CACHE_DIR
  else 
    echo "...Storing Puppeteer Cache in Build Cache" 
    cp -R $PUPPETEER_CACHE_DIR $XDG_CACHE_HOME
  fi
else
  echo "Puppeteer cache paths are the same, skipping copy"
fi

# === Debug Info: Where is Puppeteer installed? ===
echo "==== Puppeteer Debug Info ===="
echo "Node Modules Puppeteer Path:"
npm list puppeteer

echo "Puppeteer Cache Dir: $PUPPETEER_CACHE_DIR"
ls -lah $PUPPETEER_CACHE_DIR || echo "⚠️ No Puppeteer cache dir found"

# === Check if Chrome is installed in cache ===
if [[ -d "$PUPPETEER_CACHE_DIR/chrome" ]]; then
  echo "✅ Chrome directory found:"
  ls -lah "$PUPPETEER_CACHE_DIR/chrome"
else
  echo "❌ Chrome directory NOT found in cache"
fi
