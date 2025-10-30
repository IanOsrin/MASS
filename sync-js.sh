#!/bin/bash
# Sync app.js to app.min.js and update version in index.html

set -e

cd "$(dirname "$0")"

echo "Syncing app.js to app.min.js..."
cp public/app.js public/app.min.js

# Increment version number in index.html
if [ -f public/index.html ]; then
  # Get current version
  current_version=$(grep -oP 'app\.min\.js\?v=\K\d+' public/index.html || echo "0")
  new_version=$((current_version + 1))

  echo "Updating version from v=$current_version to v=$new_version in index.html..."
  sed -i.bak "s/app\.min\.js?v=[0-9]*/app.min.js?v=$new_version/" public/index.html

  echo "✓ Files synced successfully!"
  echo "✓ Version updated to v=$new_version"
else
  echo "✓ Files synced (index.html not found for version bump)"
fi

echo ""
echo "Next steps:"
echo "1. Hard refresh your browser (Ctrl+Shift+R or Cmd+Shift+R)"
echo "2. Test the buttons"
