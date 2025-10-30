# Placeholder Image Styling - Bold and Dominant

## WHAT WAS CHANGED

Made **all placeholder images** throughout the app bold and dominant with high opacity and enhanced contrast.

## LOCATIONS UPDATED

### 1. **CSS Styling** (index.html:206)
Added universal placeholder styling:
```css
img.placeholder-image, img[src*="placeholder.png"] {
  opacity: 0.85 !important;
  filter: brightness(1.1) contrast(1.15) !important;
}
```

This styling applies to:
- ✅ Loading screen background
- ✅ Song/track cards (random songs view)
- ✅ Album cards (browse/search views)
- ✅ Modal/popup album covers
- ✅ Now playing artwork
- ✅ Any image that uses `/img/placeholder.png`

### 2. **JavaScript Updates** (app.js)

#### Song Cards (line 2652-2659)
```javascript
if (picture) {
  img.onerror = () => {
    img.src = '/img/placeholder.png';
    img.classList.add('placeholder-image'); // Bold styling
  };
} else {
  img.src = '/img/placeholder.png';
  img.classList.add('placeholder-image'); // Bold styling
}
```

#### Album Cards (line 4692-4707)
Now **always shows an image** (real cover or bold placeholder):
```javascript
// Always show album cover (or placeholder)
const proxied = album.picture ?
  `/api/container?u=${encodeURIComponent(album.picture)}` :
  '/img/placeholder.png';

if (!album.picture) {
  img.classList.add('placeholder-image');
}
img.onerror = () => {
  img.src = '/img/placeholder.png';
  img.classList.add('placeholder-image');
};
```

#### Now Playing Widget (line 633-645)
```javascript
img.onerror = () => {
  img.src = '/img/placeholder.png';
  img.classList.add('placeholder-image');
};
// Also shows placeholder when no artwork exists
```

#### Modal Album Cover (line 4091-4115)
Shows bold placeholder when:
- Album cover fails to load
- Album has no cover image

## THE EFFECT

**Before:**
- Placeholder: 30% opacity (very faint)
- Albums without covers: No image shown
- Failed images: Removed or blank

**After:**
- Placeholder: **85% opacity** (highly visible)
- **Brightness +10%**, **Contrast +15%**
- Albums without covers: **Show bold placeholder**
- Failed images: **Show bold placeholder**
- **Consistent look** throughout the entire app

## VISUAL CHARACTERISTICS

```
opacity: 0.85        → Highly visible (85% vs old 30%)
brightness(1.1)      → +10% brighter
contrast(1.15)       → +15% more contrast
!important           → Overrides any conflicting styles
```

Result: **Bold, dominant, impossible to miss!**

## FILES MODIFIED

1. **public/index.html** - Added CSS rule (line 206) + version bump to v=6
2. **public/app.js** - Updated 4 locations where images are rendered
3. **public/app.min.js** - Synced from app.js

## TO SEE THE CHANGES

**Hard refresh browser:**
- **Mac**: `Cmd + Shift + R`
- **Windows/Linux**: `Ctrl + Shift + R`

**What to check:**
1. ✅ Loading screen - Placeholder much more visible
2. ✅ Songs without artwork - Bold placeholder shown
3. ✅ Albums without covers - Bold placeholder shown
4. ✅ Images that fail to load - Bold placeholder shown
5. ✅ Now playing with no art - Bold placeholder shown

## TECHNICAL NOTES

### CSS Selector Strategy
Used two selectors to catch all cases:
- `img.placeholder-image` → Class-based (explicit)
- `img[src*="placeholder.png"]` → Attribute-based (catch-all)

This ensures that even if JavaScript fails to add the class, any image with "placeholder.png" in the src will still get the bold styling!

### Always Show Images
Changed album cards from conditional rendering:
```javascript
// OLD: Only show if album.picture exists
if (album.picture) { ... }

// NEW: Always show (placeholder if no picture)
const proxied = album.picture ? realUrl : '/img/placeholder.png';
```

This ensures consistent card layouts - every album/song always has an image area.

## BENEFITS

1. **Visual Consistency** - All placeholders look the same
2. **User Awareness** - Clear indication of missing artwork
3. **Layout Stability** - No missing image gaps
4. **Better UX** - Users know it's a placeholder, not a loading error
5. **Professional Look** - Bold, intentional design choice

## SUMMARY

✅ Placeholder opacity: 30% → **85%** (much more visible)
✅ Added brightness and contrast filters
✅ Applied to ALL placeholders in the app
✅ Album cards always show images now
✅ Consistent styling everywhere
✅ Version bumped to v=6

The placeholder image is now **bold, dominant, and impossible to miss** throughout the entire application! 🎨
