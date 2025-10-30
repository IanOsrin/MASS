# Quick Button Test Checklist

## Before Testing
- [ ] Server is running: `ps aux | grep "node server.js"`
- [ ] Files are synced: `diff app.js app.min.js` should be empty
- [ ] Hard refresh browser (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows/Linux)

## Test Steps

### 1. Initial Page Load
- [ ] Page loads with random songs
- [ ] "Load More" button (🔄) is visible in header
- [ ] Songs grid is visible (not blank)

### 2. Test Load More Button
- [ ] Click "Load More" button
- [ ] Loading spinner appears
- [ ] New random songs load (different from before)
- [ ] "Load More" button stays visible

### 3. Test Clear Button
- [ ] Type something in search box
- [ ] Click "Clear" button
- [ ] Search box clears
- [ ] Random songs load
- [ ] "Load More" button is visible

### 4. Check Console (F12)
- [ ] No JavaScript errors in console
- [ ] See logs: `[renderSongsGrid]`, `[loadRandomSongs]`
- [ ] See: `[renderAlbumPage] Skipping - in songs mode`

## If Buttons Still Don't Work

1. **Check browser is loading new file:**
   - Open DevTools Network tab
   - Hard refresh
   - Find `app.min.js` request
   - Should show `app.min.js?v=2`

2. **Check files are identical:**
   ```bash
   cd /Users/ianosrin/projects/mass-music
   diff public/app.js public/app.min.js
   # Should output nothing (files are identical)
   ```

3. **Try debug page:**
   - Visit `http://localhost:3000/debug.html`
   - Test buttons there first

4. **Check server logs:**
   ```bash
   tail -f /tmp/mass-music.log
   # Should see GET /api/random-songs when clicking buttons
   ```
