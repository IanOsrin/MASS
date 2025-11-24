# CORS Configuration (Only If Frontend and API Are Separate)

## Current Status
✅ **CORS not needed** - Frontend and API are served from same origin

## When You Would Need CORS
- If frontend moves to different domain (e.g., Vercel, Netlify, different subdomain)
- If you want to allow mobile apps or third-party sites to access your API

## How to Add Secure CORS (If Needed)

### Option 1: Use the `cors` package (Already installed)

```javascript
// At top of server.js
import cors from 'cors';

// Add after other middleware, before routes
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'https://mass-music.com',
  'https://www.mass-music.com'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Allow cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));
```

### Option 2: Manual CORS middleware (More control)

```javascript
// Add after other middleware, before routes
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'https://mass-music.com',
    'https://www.mass-music.com'
  ].filter(Boolean);

  if (!origin || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || allowedOrigins[0]);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  }

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});
```

### Environment Variable Setup

Add to `.env`:
```bash
FRONTEND_URL=https://your-frontend-domain.com
```

Add to `render.yaml`:
```yaml
envVars:
  - key: FRONTEND_URL
    value: https://your-frontend-domain.com
```

## Security Checklist

- [ ] Never use `Access-Control-Allow-Origin: *` in production
- [ ] Only whitelist specific domains you control
- [ ] Use environment variables for domain configuration
- [ ] Test CORS in browser dev tools (Network tab)
- [ ] Enable credentials only if needed for cookies/auth

## Testing CORS

```bash
# Test from different origin (should fail without CORS)
curl -H "Origin: https://evil-site.com" \
     -H "Access-Control-Request-Method: POST" \
     -X OPTIONS \
     https://your-api.com/api/search

# Should return CORS headers only if origin is allowed
```

## Current Recommendation

**DO NOTHING** - Your current setup doesn't need CORS. Only implement this if you split frontend and backend to different domains.
