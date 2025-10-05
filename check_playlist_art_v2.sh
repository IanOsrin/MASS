#!/usr/bin/env bash
# Verify playlist artwork exists on disk AND is served by the app.
# Usage:
#   ./check_playlist_art_v2.sh "Marabi Mood"
#   ./check_playlist_art_v2.sh marabi-mood http://127.0.0.1:3000 public/img/Playlists

set -uo pipefail

NAME_OR_SLUG="${1:-marabi-mood}"
BASE_URL="${2:-http://127.0.0.1:3000}"
PUBLIC_DIR="${3:-public/img/playlists}"   # pass public/img/Playlists if that's your folder

# slugify -> lowercase, spaces -> hyphens, & -> and
slug="$(printf '%s' "$NAME_OR_SLUG" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/&/and/g; s/[^a-z0-9]+/-/g; s/^-+|-+$//g')"

echo "▶ Checking artwork for: \"$NAME_OR_SLUG\" (slug: \"$slug\")"
echo "   Disk directory: $PUBLIC_DIR"
echo "   Server base:    $BASE_URL"
echo

# 1) Disk check
found_path=""
for ext in webp jpg jpeg png; do
  p="$PUBLIC_DIR/$slug.$ext"
  if [ -f "$p" ]; then found_path="$p"; break; fi
done

if [ -n "$found_path" ]; then
  echo "✅ Found on disk: $found_path"
  ls -lah "$found_path"
else
  echo "❌ Not found on disk at: $PUBLIC_DIR/${slug}.(webp|jpg|jpeg|png)"
  echo "   Case-insensitive matches (if any):"
  find "$PUBLIC_DIR" -maxdepth 1 -type f -iname "${slug}.*" 2>/dev/null | sed 's/^/   -> /' || true
fi
echo

# 2) HTTP check (what the UI requests — lowercase 'playlists')
echo "▶ HTTP probe (lowercase path used by UI):"
http_ok=""
for ext in webp jpg jpeg png; do
  url="$BASE_URL/img/playlists/$slug.$ext"
  code="$(curl -s -o /dev/null -w "%{http_code}" -I "$url" || echo "000")"
  echo "   $url  -> HTTP $code"
  [ "$code" = "200" ] && http_ok="$url" && break
done
echo

# 3) Debug probe (capital P, if your folder is 'Playlists')
echo "▶ HTTP probe (capital P, for debugging):"
for ext in webp jpg jpeg png; do
  url="$BASE_URL/img/Playlists/$slug.$ext"
  code="$(curl -s -o /dev/null -w "%{http_code}" -I "$url" || echo "000")"
  echo "   $url  -> HTTP $code"
done
echo

# 4) Verdict / guidance
if [ -n "$found_path" ] && [ -n "$http_ok" ]; then
  echo "🎉 PASS: File exists and is served at: $http_ok"
  exit 0
fi

if [ -n "$found_path" ] && [ -z "$http_ok" ]; then
  cat <<'EOF'
⚠️  File exists on disk, but the lowercase URL is not served.
    Likely cause: your folder is 'Playlists' (capital P) but the UI requests '/img/playlists/...'.

Fix either:
  A) Rename the folder to lowercase (recommended):
     cd public/img
     git mv -f Playlists playlists  || (mv Playlists Playlists_tmp && mv Playlists_tmp playlists)

  B) Add an Express alias in server.js:
     app.use('/img/playlists', express.static(path.join(__dirname, 'public', 'img', 'Playlists')));
EOF
  exit 2
fi

if [ -z "$found_path" ]; then
  echo "❌ FAIL: Could not find the image on disk at the expected directory."
  echo "   Check the directory argument you passed (3rd arg)."
  exit 1
fi
