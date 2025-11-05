# PWA Setup Guide

MASS is now a **Progressive Web App (PWA)**! This means users can install it on their phones/tablets like a native app, directly from their browser.

## What's Changed?

**Nothing!** The web app works exactly the same as before. PWA is purely additive:

- ✅ **Browser users**: Everything works exactly as before
- ✅ **App users**: Can now install MASS to their home screen

## Files Added

1. **`public/manifest.json`** - Defines app metadata (name, icons, colors)
2. **`public/sw.js`** - Service worker for offline caching and faster loading
3. **`scripts/generate-pwa-icons.js`** - Script to create app icons

## Setup Instructions

### 1. Generate App Icons

First, install the required dependency:

```bash
npm install --save-dev sharp
```

Then generate the icons:

```bash
npm run generate-icons
```

This creates all necessary icon sizes from your `public/img/MAD_Logo.png`.

### 2. Test Locally

Start your server:

```bash
npm start
```

Visit `http://localhost:3000` in Chrome/Edge and:
1. Open DevTools → Application tab → Manifest
2. Check that manifest loads correctly
3. Check Service Workers are registered

### 3. Test on Mobile

**Important**: PWAs require HTTPS in production (localhost works without HTTPS).

#### Option A: Test on Same Network
1. Find your computer's local IP: `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
2. On your phone, visit: `http://YOUR-IP:3000`
3. You should see "Add to Home Screen" prompt

#### Option B: Use ngrok for Testing
```bash
npm install -g ngrok
ngrok http 3000
```
Visit the ngrok HTTPS URL on your phone.

### 4. Deploy to Production

Deploy your app with HTTPS enabled. Most hosting providers (Vercel, Netlify, Heroku, etc.) provide HTTPS automatically.

Once deployed with HTTPS:
1. Visit your site on a mobile device
2. Browser will show "Install" or "Add to Home Screen" prompt
3. Users tap to install
4. App appears on their home screen!

## How Users Install

### Android (Chrome/Edge)
1. Visit your site
2. Tap the "Add MASS to Home screen" banner
3. Or: Menu → "Install app" or "Add to Home Screen"

### iOS (Safari)
1. Visit your site
2. Tap Share button (box with arrow)
3. Scroll down → "Add to Home Screen"
4. Tap "Add"

## Features

Once installed, users get:

- 🏠 **Home screen icon** - Launches like a native app
- 📱 **Fullscreen mode** - No browser UI (on Android)
- ⚡ **Faster loading** - Static assets cached locally
- 🔄 **Offline support** - Basic functionality works offline (shows cached content)
- 🎨 **Native feel** - Splash screen, custom colors

## Customization

### Change App Name
Edit `public/manifest.json`:
```json
{
  "name": "Your New Name",
  "short_name": "Short Name"
}
```

### Change Colors
Edit `public/manifest.json`:
```json
{
  "background_color": "#0f0f12",
  "theme_color": "#0f0f12"
}
```

### Update Icons
1. Replace `public/img/MAD_Logo.png` with your new logo
2. Run: `npm run generate-icons`

### Modify Caching Strategy
Edit `public/sw.js` to change what gets cached and how.

## Cache Management

The service worker caches files for faster loading. To clear cache:

### For Development
1. Open DevTools → Application → Storage
2. Click "Clear site data"

### For Users
Users can clear cache via browser settings, or you can update the cache version in `sw.js`:

```javascript
const CACHE_NAME = 'mass-v2'; // Change version number
```

## Debugging

### Check PWA Status
1. Chrome DevTools → Lighthouse
2. Run PWA audit
3. Fix any issues reported

### Common Issues

**"Add to Home Screen" not showing:**
- Ensure HTTPS is enabled (not needed on localhost)
- Check manifest.json is valid
- Ensure service worker registered successfully

**Icons not showing:**
- Run `npm run generate-icons`
- Check icons exist in `public/img/`
- Clear cache and reload

**Service worker not updating:**
- Update cache version in `sw.js`
- Hard refresh (Ctrl+Shift+R)
- Unregister old service worker in DevTools

## Analytics

Track PWA installations by adding this to your JavaScript:

```javascript
window.addEventListener('beforeinstallprompt', (e) => {
  // User shown install prompt
  console.log('Install prompt shown');
});

window.addEventListener('appinstalled', (e) => {
  // User installed the app
  console.log('App was installed');
});
```

## Resources

- [PWA Documentation](https://web.dev/progressive-web-apps/)
- [Manifest Generator](https://www.simicart.com/manifest-generator.html/)
- [Service Worker Cookbook](https://serviceworke.rs/)
- [PWA Checklist](https://web.dev/pwa-checklist/)

## Notes

- The PWA works alongside the regular web app - nothing is removed or changed
- Users can still use it in their browser normally
- Service worker provides offline support for cached content
- All API calls still require internet connection
- Music streaming requires active connection (audio files aren't cached)
