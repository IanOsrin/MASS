# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MASS (Music Album Streaming System) is a Node.js music streaming application that integrates with FileMaker's Data API. It provides music search, playlist management, audio streaming, and playback event tracking.

**Tech Stack**: Node.js (ESM), Express 5, FileMaker Data API, JWT authentication, undici for HTTP, PWA-enabled

**PWA Support**: MASS is a Progressive Web App, allowing users to install it on their mobile devices directly from their browser. The PWA features are purely additive - the web app works identically in browsers while offering an optional install experience.

## Development Commands

```bash
# Start the server with clustering (recommended for production)
npm start

# Start single server instance (recommended for development/debugging)
npm run start:single

# Run smoke tests (validates health and search endpoints)
npm run smoke

# Set custom base URL for smoke tests
SMOKE_BASE_URL=http://localhost:3000 npm run smoke

# Remove email addresses from playlists (privacy migration)
node scripts/remove-emails-from-playlists.js

# Generate PWA icons (requires sharp: npm install --save-dev sharp)
npm run generate-icons
```

## PWA (Progressive Web App)

MASS can be installed as a Progressive Web App on mobile devices. See [PWA-SETUP.md](PWA-SETUP.md) for complete setup instructions.

**Quick Start:**
1. Install sharp: `npm install --save-dev sharp`
2. Generate icons: `npm run generate-icons`
3. Deploy with HTTPS (required for PWA in production)
4. Users can "Add to Home Screen" from their mobile browser

**Files:**
- `public/manifest.json` - PWA configuration
- `public/sw.js` - Service worker for caching
- `scripts/generate-pwa-icons.js` - Icon generator
```

## Environment Configuration

Required `.env` variables:

```bash
# FileMaker Data API connection
FM_HOST=https://your-filemaker-host.com
FM_DB=YourDatabaseName
FM_USER=api_user
FM_PASS=api_password

# Optional FileMaker layouts (defaults shown)
FM_LAYOUT=API_Album_Songs
FM_USERS_LAYOUT=API_Users
FM_STREAM_EVENTS_LAYOUT=Stream_Events

# JWT authentication
AUTH_SECRET=your-secure-secret-key

# Server configuration
PORT=3000
HOST=127.0.0.1
NODE_ENV=development  # or production

# Optional
DEBUG_STREAM_EVENTS=true
AUTH_COOKIE_SECURE=false  # set to true in production
```

## Architecture

### Core Components

**server.js** (2380 lines) - Main application file containing:
- Express server setup and middleware
- All API route handlers
- FileMaker Data API integration layer
- Authentication logic (JWT + bcrypt)
- Stream event tracking system
- Playlist management
- Audio streaming from FileMaker containers
- Audio validation and filtering (only shows tracks with valid audio files)

**worker.js** - Background worker process (currently a placeholder with heartbeat logging)

**public/index.html** - Single-page application frontend (vanilla JS, no framework)
- Responsive design with mobile/tablet breakpoints (900px, 600px, 400px)
- Touch-friendly controls (48px minimum touch targets for phones)
- Collapsible playlist sections (My Playlists, Featured Playlists)
- Email sharing integration via mailto: links
- Music note emoji favicon (🎵)

**public/app.min.js** - Frontend JavaScript (minified)
- Auto-advance logic for all playlist types
- Container URL refresh during auto-advance for user playlists
- Audio validation and caching

**data/** - JSON file storage:
- `playlists.json` - User-created playlists
- `users.json` - User data
- `playlist_requests.json` - Playlist creation requests

### FileMaker Integration Layer

The server implements a complete FileMaker Data API client with the following patterns:

**Authentication**: Token-based with automatic renewal
- Tokens expire after 12 minutes
- 401 responses trigger automatic re-authentication
- Function: `fmLogin()`, `ensureToken()`

**Core API Functions** (all in server.js:375-620):
- `fmLogin()` - Authenticate with FileMaker
- `fmCreateRecord(layout, fieldData)` - Create records
- `fmUpdateRecord(layout, recordId, fieldData)` - Update records
- `fmGetRecordById(layout, recordId)` - Get single record
- `fmFindRecords(layout, queries, options)` - Find records with query
- `fmPost(pathSuffix, body)` - Generic POST to Data API
- `fmGetAbsolute(url, options)` - GET with authentication headers

**Network Resilience** (`safeFetch()` in server.js:281-346):
- 15-second default timeout
- Automatic retry with exponential backoff
- Handles connection resets, timeouts, socket errors
- AbortSignal composition for external cancellation

**Field Name Flexibility**: The codebase handles multiple field name variations for FileMaker fields that may differ across layouts:
- Audio fields: `['mp3', 'MP3', 'Audio File', 'Audio::mp3']`
- Artwork fields: `['Artwork::Picture', 'Artwork Picture', 'Picture']`
- Public playlist fields: Various `PublicPlaylist` and `Tape Files::PublicPlaylist` variants
- Track sequence fields: ~15 variations of track/song numbering fields

See constants at server.js:77-115.

### API Endpoints

**Authentication** (`/api/auth/*`):
- `POST /api/auth/register` - Create new user account (email + password)
- `POST /api/auth/login` - Login (returns JWT in cookie)
- `POST /api/auth/logout` - Clear session cookie
- `GET /api/auth/me` - Get current authenticated user

**Playlist Management** (`/api/playlists/*`):
- `GET /api/playlists` - List user's playlists
- `POST /api/playlists` - Create new playlist
- `DELETE /api/playlists/:playlistId` - Delete playlist
- `POST /api/playlists/:playlistId/tracks` - Add single track
- `POST /api/playlists/:playlistId/tracks/bulk` - Add multiple tracks
- `POST /api/playlists/:playlistId/share` - Generate share link

**Music Discovery**:
- `GET /api/search?artist=...&album=...&song=...&limit=N` - Search tracks
- `GET /api/explore` - Browse albums (paginated)
- `GET /api/album?title=...&artist=...` - Get album details
- `GET /api/public-playlists` - List FileMaker public playlists

**Sharing**:
- `GET /api/shared-playlists/:shareId` - Access shared playlist by ID

**Audio Streaming**:
- `GET /api/container?url=<encoded-url>` - Stream audio from FileMaker container
- `GET /api/track/:recordId/container` - Get track audio URL

**Analytics**:
- `POST /api/stream-events` - Track playback events (PLAY, PROGRESS, PAUSE, SEEK, END, ERROR)

**Monitoring**:
- `GET /api/cache/stats` - Get cache performance statistics (hit rate, size, TTL)

### Audio Validation

All API endpoints that return music tracks automatically filter and hide albums without valid audio files. The validation process:

**Backend Filtering** (server.js:650-656):
1. Checks for presence of audio field (mp3, MP3, Audio File, Audio::mp3)
2. Validates that the field contains a non-empty value
3. Verifies the value can be resolved to a playable source URL

**Frontend Hiding** (index.html:90):
- Albums without playable audio are marked with `.no-audio` class
- These albums are completely hidden via `display: none !important`
- No red borders or visual indicators - they simply don't appear

**Implementation**:
- Backend: `hasValidAudio(fields)` function used by `/api/search`, `/api/explore`, `/api/album`, `/api/public-playlists`
- Frontend: CSS rule `.card.no-audio{display:none !important;}`
- Prevents display of albums/tracks that cannot be played
- Reduces user frustration from non-playable content

This ensures users only see content they can actually stream.

### Authentication System

**Implementation** (server.js:840-904):
- JWT tokens stored in `mass_session` cookie
- 7-day token expiration
- Passwords hashed with bcrypt (10 rounds)
- Minimum password length: 8 characters
- Email validation with regex

**Auth Middleware**: `authenticateRequest(req)` (server.js:872-884)
- Reads JWT from cookie or Authorization header
- Verifies token signature
- Fetches user record from FileMaker
- Returns null for invalid/expired tokens

**Protected Routes**: Check user with `authenticateRequest()` and return 401 if null.

**Guest User Engagement**:
- Guest users can browse freely without an account
- After 10 minutes of browsing, a friendly prompt encourages subscription/login (app.min.js:6186-6244)
- Prompt highlights benefits: save playlists, share with friends, never lose collection
- Shows only once per session
- Timer automatically cancels if user logs in before 10 minutes
- Non-intrusive - users can dismiss and continue browsing
- **Humorous Ads for Guest Users** (index.html:624-662):
  - When not logged in, the playlist sidebar shows 4 funny music-themed advertisements
  - Ads are intentionally humorous and self-aware (e.g., "Learn Guitar in 3 Minutes!" → "Just kidding. It takes years.")
  - Includes disclaimer encouraging subscription to remove ads
  - Automatically hidden when user logs in
  - Provides engaging content while subtly encouraging subscription

### Stream Event Tracking

The system tracks detailed playback analytics in FileMaker's Stream_Events layout for usage statistics.

**Event Types**: `PLAY`, `PROGRESS`, `PAUSE`, `SEEK`, `END`, `ERROR`

**Record Management** (server.js:1090-1168):
- Each session + track combination gets one stream record
- 30-minute cache for record IDs
- Terminal events (END, ERROR) create new records on next play
- Records store: SessionID, TrackRecordID, timestamps, playback position, client IP, ASN

**Data Fields Tracked**:
- Time streamed (seconds)
- Last event type and timestamp
- Client IP address (analytics only)
- ASN (placeholder for future MaxMind integration)

**Important**: IP addresses are ONLY used for stream event analytics (play tracking) and are NOT stored in playlists or exposed during playlist sharing.

### Playlist Sharing System

**Share Flow**:
1. User creates playlist and adds tracks
2. `POST /api/playlists/:id/share` generates UUID-based shareId
3. Playlist data saved to `playlists.json` with shareId (privacy-focused, no user emails)
4. Share URL returned: `https://domain.com/?share=<shareId>`
5. Recipients access via `GET /api/shared-playlists/:shareId`

**Privacy & Security**:
- ✅ **No email addresses stored** - Only userId (FileMaker record ID) is stored
- ✅ **No IP addresses in sharing** - IP addresses only used for analytics (stream events)
- ✅ **UUID-based share links** - Random, non-guessable share IDs
- ✅ **Sanitized sharing** - Only track metadata shared (names, artists, albums)
- ✅ **No user identification** - Recipients cannot see who created the playlist
- ✅ **Automatic cleanup** - Email addresses removed from playlists on load/save

**Implementation Details** (server.js:939-1008, 1524-1542):
- `loadPlaylists()` strips email addresses when loading
- `savePlaylists()` strips email addresses before saving
- `sanitizePlaylistForShare()` only includes track metadata, timestamps, and shareId

### Playlist Auto-Advance

The system automatically advances to the next track when a track finishes playing.

**Implementation** (app.min.js:5573-5670):
- Works for all playlist types: user playlists, public playlists, and shared playlists
- Sets `currentMode` appropriately:
  - `'user-playlist'` for user-created playlists (app.min.js:922)
  - `'public-playlist'` for Featured playlists (app.min.js:3594)
  - `'shared-playlist'` for shared playlists (app.min.js:4389)
- Auto-advance enabled when `currentMode !== 'songs'` (random songs mode)

**Container URL Refresh**:
- FileMaker container URLs can expire (401 Unauthorized)
- During auto-advance, user and shared playlist tracks automatically refresh their container URLs (app.min.js:5621-5644, 5677-5699)
- Manual clicks also refresh URLs:
  - User playlists: app.min.js:1125-1149
  - Shared playlists: app.min.js:4155-4194
- Uses `refreshTrackContainerSource()` with 30-minute cache
- Prevents playback failures from expired URLs

**Track Discovery**:
1. Attempts sibling traversal via `findNextPlayableRow(currentRow)`
2. Fallback: Searches appropriate container based on playlist type
3. Skips tracks without valid audio sources

## Code Patterns & Conventions

### Error Handling

FileMaker API errors include the error message and code from FileMaker's response:
```javascript
if (!res.ok) {
  const msg = json?.messages?.[0]?.message || 'FM error';
  const code = json?.messages?.[0]?.code;
  throw new Error(`FM operation failed: ${msg} (${code ?? 'n/a'})`);
}
```

### Data Normalization

Key normalization functions:
- `normalizeRecordId(value)` - Trim and stringify record IDs
- `normalizeEmail(email)` - Lowercase and trim emails
- `normalizeShareId(value)` - Trim share ID strings
- `slugifyPlaylistName(name)` - Convert playlist names to URL-safe slugs

### Playlist Image Resolution

Images stored in `public/img/Playlists/` with playlist name as filename (slugified).
Function `resolvePlaylistImage(name)` checks for files in order: `.webp`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.svg`

Results cached in `playlistImageCache` Map.

## Testing

**Smoke Test** (`scripts/smoke.js`):
- Validates `/api/health` returns uptime
- Tests artist search with configurable query
- Set `SMOKE_ARTIST` env var to customize search term

## Common Development Tasks

**Adding a New API Endpoint**:
1. Add route handler in server.js (around line 1200+)
2. Use `authenticateRequest(req)` for protected routes
3. Use `fmFindRecords()` or `fmCreateRecord()` for FileMaker operations
4. Wrap in try-catch and return appropriate HTTP status codes

**Modifying FileMaker Field Mappings**:
1. Update field name arrays at server.js:77-115
2. Common patterns use arrays to try multiple field name variations
3. First match wins when iterating through field name candidates

**Adding Stream Event Types**:
1. Add to `STREAM_EVENT_TYPES` Set (server.js:59)
2. Update `STREAM_TERMINAL_EVENTS` if event should reset stream record
3. Modify event handler in `POST /api/stream-events` (server.js:1202+)

**Changing Authentication Settings**:
1. Modify constants at server.js:67-74
2. Update `AUTH_SECRET` in environment (never commit actual secret)
3. Token expiration: `AUTH_COOKIE_MAX_AGE` (default: 7 days)

## Important Notes

- **ES Modules**: This project uses `"type": "module"` - use `import`/`export` syntax
- **Node Version**: Requires Node.js >= 18
- **Single File Server**: All backend logic is in server.js - consider refactoring into modules if it grows beyond 3000 lines
- **No Database**: User playlists stored in JSON files (consider moving to proper DB for production)
- **FileMaker Container Streaming**: Audio files are proxied through the server to add authentication headers
- **CORS**: Not currently configured - add if frontend is served from different origin
