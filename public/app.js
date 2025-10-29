    const albumsEl = document.getElementById('albums');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const searchEl = document.getElementById('search');
    const clearEl  = document.getElementById('clear');
    const goEl  = document.getElementById('go');
    const headerEl = document.querySelector('header');
    const pagerEl  = document.getElementById('pager');
    const prevEl   = document.getElementById('prev');
    const nextEl   = document.getElementById('next');
    const pageInfo = document.getElementById('pageInfo');
    const shuffleBtn = document.getElementById('shuffleBtn');
    const countEl  = document.getElementById('count');
    const errorEl  = document.getElementById('error');
    const player   = document.getElementById('player');
    const landingEl = null; // placeholder removed
    const exploreEl = document.getElementById('explore');
    const explorePanel = document.getElementById('explorePanel');
    const exploreDecadesEl = document.getElementById('exploreDecades');
    const exploreGenresEl = document.getElementById('exploreGenres');
    const exploreMoodsEl = document.getElementById('exploreMoods');
    const publicFeaturedRow = null; // Removed - featured playlists now in sidebar

    // Modal elements
    const overlay = document.getElementById('overlay');
    const modalCover = document.getElementById('modalCover');
    const modalTitle = document.getElementById('modalTitle');
    const modalArtist = document.getElementById('modalArtist');
    const modalCat = document.getElementById('modalCat');
    const modalContent = document.getElementById('modalContent');
    const modalClose = document.getElementById('modalClose');
    const trackInfoOverlay = document.getElementById('trackInfoOverlay');
    const trackInfoDialog = document.getElementById('trackInfoDialog');
    const trackInfoBody = document.getElementById('trackInfoBody');
    const trackInfoClose = document.getElementById('trackInfoClose');

    const playlistColumn = document.getElementById('playlistColumn');
    const publicPlaylistsPanel = document.getElementById('publicPlaylistsPanel');
    const publicPlaylistsList = document.getElementById('publicPlaylistsList');
    const publicPlaylistsEmpty = document.getElementById('publicPlaylistsEmpty');
    const playlistsPanel = document.getElementById('playlistsPanel');
    const playlistsList = document.getElementById('playlistsList');
    const playlistsStatus = document.getElementById('playlistsStatus');
    const playlistsEmpty = document.getElementById('playlistsEmpty');
    const playlistCreateForm = document.getElementById('playlistCreateForm');
    const playlistNameInput = document.getElementById('playlistNameInput');
    const nowPlayingCard = document.getElementById('nowPlayingCard');
    const nowPlayingThumb = document.getElementById('nowPlayingThumb');
    const nowPlayingTitle = document.getElementById('nowPlayingTitle');
    const nowPlayingSubtitle = document.getElementById('nowPlayingSubtitle');
    const nowPlayingSource = document.getElementById('nowPlayingSource');
    const nowPlayingStatus = document.getElementById('nowPlayingStatus');
    const nowPlayingMetaButtons = document.getElementById('nowPlayingMetaButtons');
    const nowPlayingToggleButton = document.getElementById('nowPlayingToggle');
    const nowPlayingCollapseButton = document.getElementById('nowPlayingCollapse');
    const nowPlayingProgressFill = document.getElementById('nowPlayingProgressFill');
    const playlistTracksSection = document.getElementById('playlistTracksSection');
    const playlistTracksTitle = document.getElementById('playlistTracksTitle');
    const playlistTracksMeta = document.getElementById('playlistTracksMeta');
    const playlistTracksList = document.getElementById('playlistTracksList');
    const playlistTracksEmpty = document.getElementById('playlistTracksEmpty');
    const togglePlaylistTracksButton = document.getElementById('togglePlaylistTracks');
    const sharePlaylistButton = document.getElementById('sharePlaylistButton');
    const shareLinkOutput = document.getElementById('shareLinkOutput');
    const deletePlaylistButton = document.getElementById('deletePlaylistButton');
    const publicPlaylistView = document.getElementById('publicPlaylistView');
    const publicPlaylistTitle = document.getElementById('publicPlaylistTitle');
    const publicPlaylistMeta = document.getElementById('publicPlaylistMeta');
    const publicPlaylistStatus = document.getElementById('publicPlaylistStatus');
    const publicPlaylistHero = document.getElementById('publicPlaylistHero');
    const publicPlaylistArt = document.getElementById('publicPlaylistArt');
    const publicPlaylistTracks = document.getElementById('publicPlaylistTracks');
    const publicPlaylistEmpty = document.getElementById('publicPlaylistEmpty');
    const sharedPlaylistView = document.getElementById('sharedPlaylistView');
    const sharedPlaylistTitle = document.getElementById('sharedPlaylistTitle');
    const sharedPlaylistMeta = document.getElementById('sharedPlaylistMeta');
    const sharedPlaylistStatus = document.getElementById('sharedPlaylistStatus');
    const sharedPlaylistHero = document.getElementById('sharedPlaylistHero');
    const sharedPlaylistArt = document.getElementById('sharedPlaylistArt');
    const sharedPlaylistTracks = document.getElementById('sharedPlaylistTracks');
    const sharedPlaylistEmpty = document.getElementById('sharedPlaylistEmpty');
    const sharedPlaylistBackButton = document.getElementById('sharedPlaylistBack');
    const sharedPlaylistCopyButton = document.getElementById('sharedPlaylistCopy');

    const authControls = document.getElementById('authControls');
    const loginTrigger = document.getElementById('loginTrigger');
    const signupTrigger = document.getElementById('signupTrigger');
    const logoutButton = document.getElementById('logoutButton');
    const userBadge = document.getElementById('userBadge');
    const authOverlay = document.getElementById('authOverlay');
    const authDialog = document.getElementById('authDialog');
    const authClose = document.getElementById('authClose');
    const authForm = document.getElementById('authForm');
    const authTitle = document.getElementById('authTitle');
    const authEmail = document.getElementById('authEmail');
    const authPassword = document.getElementById('authPassword');
    const authSubmit = document.getElementById('authSubmit');
    const authSwitch = document.getElementById('authSwitchMode');
    const authToggleText = document.getElementById('authToggleText');
    const authError = document.getElementById('authError');

    const shareModal = document.getElementById('shareModal');
    const shareLinkInput = document.getElementById('shareLinkInput');
    const shareModalClose = document.getElementById('shareModalClose');

    const trackInfoFocusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    let trackInfoReturnFocus = null;
    let trackInfoFocusables = [];

    let authReturnFocus = null;
    let authMode = 'login';
    let authBusy = false;
    let currentUser = null;
    let playlists = [];
    let playlistsLoaded = false;
    let playlistsLoading = false;
    let activePlaylistId = null;
    let playlistTracksCollapsed = true;
    let nowPlayingInfo = { meta: null, isPlaying: false };
    let nowPlayingCollapsed = false;
    let publicPlaylistsLoaded = false;
    let publicPlaylistsLoading = false;
    let publicPlaylistsError = null;
    let publicPlaylistTracksLoading = false;
    let publicPlaylistTracksError = null;
    const publicPlaylistTracksCache = new Map();
    let activePublicPlaylistTracks = [];
    let publicPlaylistsSummary = [];
    let activePublicPlaylist = null;
    let activePublicPlaylistImage = '';
    let sharedPlaylistActive = false;
    let sharedPlaylistLoading = false;
    let sharedPlaylistError = null;
    let sharedPlaylistData = null;
    let activeSharedShareId = '';
    let sharedPlaylistShareUrl = '';

    const STREAM_EVENTS_ENDPOINT = '/api/stream-events';
    const STREAM_SESSION_STORAGE_KEY = 'mass.session';
    const STREAM_PROGRESS_INTERVAL_MS = 30 * 1000;
    const STREAM_DEBUG = Boolean(window.massStreamDebug);
    let streamSessionId = null;
    try {
      streamSessionId = localStorage.getItem(STREAM_SESSION_STORAGE_KEY);
    } catch {
      streamSessionId = null;
    }
    if (!streamSessionId) {
      const fallbackId = (window.crypto && typeof window.crypto.randomUUID === 'function')
        ? window.crypto.randomUUID()
        : Math.random().toString(36).slice(2);
      streamSessionId = fallbackId;
      try {
        localStorage.setItem(STREAM_SESSION_STORAGE_KEY, streamSessionId);
      } catch {
        // ignore storage failures; rely on cookie fallback from server
      }
    }
    let lastStreamReportTs = 0;
    let lastStreamReportPos = 0;
    let lastProgressSentAt = 0;
    let lastProgressAttemptTs = 0;
    let seekStartPosition = 0;

    function getCurrentTrackMeta(){
      return (nowPlayingInfo && nowPlayingInfo.meta) || {};
    }

    function toSeconds(value){
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric)) return 0;
      return Math.max(0, Math.round(numeric));
    }

    async function sendStreamEvent(type, metaOverride, positionOverride, durationOverride, deltaOverride){
      if (typeof fetch !== 'function') return false;
      const requestTs = Date.now();
      const meta = metaOverride && typeof metaOverride === 'object' ? metaOverride : getCurrentTrackMeta();
      const rawPos = typeof positionOverride === 'number' ? positionOverride : player?.currentTime || 0;
      const rawDur = typeof durationOverride === 'number' ? durationOverride : player?.duration || 0;
      const normalizedPos = toSeconds(rawPos);
      const normalizedDur = toSeconds(rawDur);
      const hasOverride = Number.isFinite(deltaOverride);
      const overrideDelta = hasOverride ? Math.max(0, Math.round(deltaOverride)) : 0;
      const deltaFromPos = Math.max(0, normalizedPos - (Number.isFinite(lastStreamReportPos) ? lastStreamReportPos : 0));
      const deltaFromTime = lastStreamReportTs ? Math.max(0, Math.round((requestTs - lastStreamReportTs) / 1000)) : 0;
      const normalizedDelta = hasOverride ? overrideDelta : (deltaFromPos || deltaFromTime);

      const body = {
        eventType: type,
        trackRecordId: meta.trackRecordId || meta.recordId || meta.id || '',
        trackISRC: meta.trackISRC || meta.isrc || meta.ISRC || '',
        positionSec: normalizedPos,
        durationSec: normalizedDur,
        deltaSec: normalizedDelta
      };

      let responseJson = null;
      try {
        const response = await fetch(STREAM_EVENTS_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Session-ID': streamSessionId
          },
          body: JSON.stringify(body)
        });
        if (!response.ok) {
          let detail = '';
          try {
            const mime = response.headers?.get ? response.headers.get('Content-Type') : '';
            if (mime && mime.includes('application/json')) {
              responseJson = await response.json();
              detail = responseJson?.error || JSON.stringify(responseJson);
            } else {
              detail = await response.text();
            }
          } catch {
            // ignore parsing errors
          }
          console.warn('[MASS] stream event rejected', { status: response.status, detail, body });
          return false;
        }
        responseJson = await response.json().catch(() => null);
        if (!responseJson?.ok) {
          console.warn('[MASS] stream event server reported failure', { response: responseJson, body });
          return false;
        }
        if (STREAM_DEBUG) {
          console.info('[MASS] stream event sent', {
            type,
            trackRecordId: body.trackRecordId,
            positionSec: body.positionSec,
            deltaSec: body.deltaSec,
            recordId: responseJson.recordId || null,
            totalPlayedSec: responseJson.totalPlayedSec || null
          });
        }
      } catch (err) {
        console.warn('[MASS] stream event send failed', err, body);
        return false;
      }

      lastStreamReportTs = requestTs;
      lastStreamReportPos = normalizedPos;
      if (type === 'PROGRESS') {
        lastProgressSentAt = requestTs;
      }
      return true;
    }

    // Config
    const ALBUMS_PER_PAGE = 8;
    const FM_FETCH_LIMIT  = 300; // Balanced: enough for diverse albums without timing out
    const PLAYLIST_ARTWORK_BASE = '/img/playlists/';
    const PLAYLIST_ARTWORK_EXTENSIONS = ['.webp', '.png', '.jpg', '.jpeg', '.avif'];

    function normalizePlaylistName(name){
      return (name || '')
        .toString()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’']/g, "'")
        .trim();
    }

    function slugifyPlaylistName(name){
      return normalizePlaylistName(name)
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    }

    function buildPlaylistArtworkCandidates(name){
      const normalized = normalizePlaylistName(name);
      const slug = slugifyPlaylistName(name);
      const baseNames = new Set();
      const addCandidate = (value) => {
        const trimmed = (value || '').trim();
        if (trimmed) baseNames.add(trimmed);
      };

      if (normalized) {
        addCandidate(normalized);
        addCandidate(normalized.replace(/&/g, ' and '));
        const collapsed = normalized.replace(/&/g, ' and ').replace(/[^A-Za-z0-9]+/g, ' ').trim();
        if (collapsed) {
          const parts = collapsed.split(/\s+/);
          const lowerParts = parts.map((part) => part.toLowerCase());
          const titleParts = parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
          addCandidate(parts.join(' '));
          addCandidate(parts.join('-'));
          addCandidate(parts.join('_'));
          addCandidate(lowerParts.join(' '));
          addCandidate(lowerParts.join('-'));
          addCandidate(lowerParts.join('_'));
          addCandidate(titleParts.join(' '));
          addCandidate(titleParts.join('-'));
          addCandidate(titleParts.join('_'));
          addCandidate(parts.join(''));
          addCandidate(lowerParts.join(''));
          addCandidate(titleParts.join(''));
        }
      }

      if (slug) {
        addCandidate(slug);
        addCandidate(slug.replace(/-/g, '_'));
        addCandidate(slug.replace(/-/g, ' '));
        addCandidate(slug.replace(/-/g, ''));
      }

      const candidates = [];
      baseNames.forEach((base) => {
        PLAYLIST_ARTWORK_EXTENSIONS.forEach((ext) => {
          const candidate = `${PLAYLIST_ARTWORK_BASE}${base}${ext}`;
          candidates.push(candidate);
        });
      });
      return candidates;
    }

    function resetPlaylistArtwork(imgEl, containerEl){
      if (containerEl) containerEl.hidden = true;
      if (!imgEl) return;
      imgEl.style.display = 'none';
      imgEl.removeAttribute('src');
      imgEl.removeAttribute('data-playlist-artwork-key');
      imgEl.removeAttribute('data-playlist-artwork-candidate');
      imgEl.onload = null;
      imgEl.onerror = null;
    }

    function loadPlaylistArtwork(imgEl, containerEl, name, options = {}){
      if (!imgEl) return;
      const normalized = normalizePlaylistName(name);
      const preferred = Array.isArray(options.preferredUrls)
        ? options.preferredUrls.filter((url) => typeof url === 'string' && url.trim())
        : [];
      const candidates = [
        ...preferred,
        ...(normalized ? buildPlaylistArtworkCandidates(normalized) : [])
      ];

      const altText = options.altText || (name ? `${name} artwork` : 'Playlist artwork');
      imgEl.alt = altText;

      if (!candidates.length) {
        resetPlaylistArtwork(imgEl, containerEl);
        return;
      }

      const key = `${normalized}::${candidates.join('|')}`;
      imgEl.dataset.playlistArtworkKey = key;
      if (containerEl) containerEl.hidden = true;
      imgEl.style.display = 'none';

      let index = 0;
      const applyNext = () => {
        if (imgEl.dataset.playlistArtworkKey !== key) return;
        if (index >= candidates.length) {
          resetPlaylistArtwork(imgEl, containerEl);
          return;
        }
        const nextUrl = candidates[index++];
        imgEl.dataset.playlistArtworkCandidate = nextUrl;
        imgEl.onerror = () => {
          if (imgEl.dataset.playlistArtworkKey !== key) return;
          applyNext();
        };
        imgEl.onload = () => {
          if (imgEl.dataset.playlistArtworkKey !== key) return;
          const validSize = Number(imgEl.naturalWidth) > 1 && Number(imgEl.naturalHeight) > 1;
          if (!validSize) {
            applyNext();
            return;
          }
          imgEl.style.display = 'block';
          if (containerEl) containerEl.hidden = false;
        };
        imgEl.src = nextUrl;
      };

      applyNext();
    }

    function applyPlaylistThumbArtwork(element, name, remoteUrl = ''){
      if (!element) return;
      const normalized = normalizePlaylistName(name);
      const fallbackChar = (name || '').trim().charAt(0) || '♪';
      element.textContent = fallbackChar;
      element.classList.remove('has-art');
      element.style.backgroundImage = '';

      const candidates = [];
      if (typeof remoteUrl === 'string' && remoteUrl.trim()) candidates.push(remoteUrl.trim());
      if (normalized) candidates.push(...buildPlaylistArtworkCandidates(normalized));
      if (!candidates.length) return;

      const key = `${normalized}::${candidates.join('|')}`;
      element.dataset.playlistThumbKey = key;
      let index = 0;

      const tryNext = () => {
        if (element.dataset.playlistThumbKey !== key) return;
        if (index >= candidates.length) return;
        const candidate = candidates[index++];
        const probe = new Image();
        probe.onload = () => {
          if (element.dataset.playlistThumbKey !== key) return;
          const validSize = Number(probe.naturalWidth) > 1 && Number(probe.naturalHeight) > 1;
          if (!validSize) {
            tryNext();
            return;
          }
          element.style.backgroundImage = `url(${probe.src})`;
          element.textContent = '';
          element.classList.add('has-art');
        };
        probe.onerror = () => {
          if (element.dataset.playlistThumbKey !== key) return;
          tryNext();
        };
        probe.src = candidate;
      };

      tryNext();
    }

    // State
    let lastQ = '';
    let prevSearch = null;
    let inFlight = null;

    // Busy status indicator
    const statusEl = document.getElementById('status');
    const statusTextEl = document.getElementById('statusText');
    let busyCount = 0;
    function showBusy(label='Searching…'){
      busyCount++;
      if (statusTextEl) statusTextEl.textContent = label;
      if (statusEl) statusEl.hidden = false;
      if (goEl) goEl.disabled = true;
      if (exploreEl) exploreEl.disabled = true;
        }
    function hideBusy(){
      busyCount = Math.max(0, busyCount - 1);
      if (busyCount === 0){
        if (statusEl) statusEl.hidden = true;
        if (goEl) goEl.disabled = false;
        if (exploreEl) exploreEl.disabled = false;
      }
        }

    function clearAuthError(){
      if (!authError) return;
      authError.hidden = true;
      authError.textContent = '';
    }

    function setAuthError(message){
      if (!authError) return;
      if (!message) {
        clearAuthError();
        return;
      }
      authError.hidden = false;
      authError.textContent = message;
    }

    function setAuthMode(mode){
      authMode = mode === 'register' ? 'register' : 'login';
      if (authTitle) authTitle.textContent = authMode === 'register' ? 'Create account' : 'Log in';
      if (authSubmit) {
        const base = authMode === 'register' ? 'Sign up' : 'Log in';
        authSubmit.textContent = authBusy
          ? (authMode === 'register' ? 'Creating…' : 'Signing in…')
          : base;
      }
      if (authToggleText) authToggleText.textContent = authMode === 'register' ? 'Already have an account?' : 'Need an account?';
      if (authSwitch) authSwitch.textContent = authMode === 'register' ? 'Log in' : 'Sign up';
      if (authPassword) authPassword.setAttribute('autocomplete', authMode === 'register' ? 'new-password' : 'current-password');
    }

    function setAuthBusy(isBusy){
      authBusy = !!isBusy;
      if (authSubmit) {
        authSubmit.disabled = authBusy;
        const base = authMode === 'register' ? 'Sign up' : 'Log in';
        authSubmit.textContent = authBusy
          ? (authMode === 'register' ? 'Creating…' : 'Signing in…')
          : base;
      }
      if (authSwitch) authSwitch.disabled = authBusy;
      if (authClose) authClose.disabled = authBusy;
      updateAuthUI();
    }

    function updateAuthUI(){
      const email = currentUser?.email || '';
      if (userBadge) {
        if (email) {
          userBadge.textContent = email;
          userBadge.hidden = false;
        } else {
          userBadge.hidden = true;
          userBadge.textContent = '';
        }
      }
      if (logoutButton) {
        logoutButton.hidden = !email;
        logoutButton.disabled = authBusy;
      }
      if (loginTrigger) {
        loginTrigger.hidden = !!email;
        loginTrigger.disabled = authBusy && !email;
      }
      if (signupTrigger) {
        signupTrigger.hidden = !!email;
        signupTrigger.disabled = authBusy && !email;
      }
      if (authControls) {
        authControls.hidden = false;
      }
      const hasUser = !!currentUser;
      const hasPublicPlaylists = publicPlaylistsSummary.length > 0;
      const showPublicPanel = hasPublicPlaylists || publicPlaylistsLoading || !!publicPlaylistsError;
      if (playlistColumn) playlistColumn.hidden = !hasUser;
      if (publicPlaylistsPanel) publicPlaylistsPanel.hidden = !showPublicPanel;
      if (playlistsPanel) playlistsPanel.hidden = !hasUser;
      syncPublicFeaturedVisibility();
      renderPlaylistsPanel();
    }

    function getMetaFromRow(row){
      if (!row) return null;
      const base = row._meta ? { ...row._meta } : null;
      if (!base) return null;
      if (base.playlistId && !base.playlistName) {
        const pl = playlists.find((p) => p && p.id === base.playlistId);
        if (pl) base.playlistName = pl.name || '';
      }
      base.src = row._src || '';
      return base;
    }

    function updateNowPlayingUI(){
      if (!nowPlayingCard) return;
      const meta = nowPlayingInfo.meta;
      const isPlaying = !!nowPlayingInfo.isPlaying;
      if (!meta) {
        if (nowPlayingProgressFill) nowPlayingProgressFill.style.width = '0%';
        if (nowPlayingMetaButtons) nowPlayingMetaButtons.innerHTML = '';
        nowPlayingCard.hidden = true;
        if (nowPlayingToggleButton) {
          nowPlayingToggleButton.textContent = '▶';
          nowPlayingToggleButton.setAttribute('aria-label', 'Play track');
          nowPlayingToggleButton.disabled = true;
        }
        return;
      }

      nowPlayingCard.hidden = !isPlaying;
      nowPlayingCard.classList.toggle('collapsed', nowPlayingCollapsed);

      if (nowPlayingTitle) nowPlayingTitle.textContent = meta.trackName || 'Track';
      if (nowPlayingSubtitle) nowPlayingSubtitle.textContent = meta.trackArtist || meta.albumArtist || '';

      if (nowPlayingSource) {
        const parts = [];
        if (meta.playlistName) parts.push(`Playlist • ${meta.playlistName}`);
        if (meta.albumTitle) parts.push(meta.playlistName ? `Album • ${meta.albumTitle}` : meta.albumTitle);
        if (meta.catalogue) parts.push(`#${meta.catalogue}`);
        nowPlayingSource.textContent = parts.join(' • ');
      }

      if (nowPlayingMetaButtons) {
        nowPlayingMetaButtons.innerHTML = '';
        const infoButton = document.createElement('button');
        infoButton.type = 'button';
        infoButton.className = 'btn small info-more';
        infoButton.setAttribute('aria-label', 'More track info');
        infoButton.innerHTML = '<span aria-hidden="true">⋮</span>';
        infoButton.addEventListener('click', () => openTrackInfoModal(meta, infoButton));
        nowPlayingMetaButtons.appendChild(infoButton);

        const details = collectTrackMetadata(meta);
        if (details.length) {
          const list = document.createElement('div');
          list.className = 'now-playing-meta-list';
          details.forEach(({ label, value }) => {
            const line = document.createElement('div');
            line.className = 'now-playing-meta-line';
            const key = document.createElement('strong');
            key.textContent = `${label}:`;
            line.appendChild(key);
            line.appendChild(document.createTextNode(` ${value}`));
            list.appendChild(line);
          });
          nowPlayingMetaButtons.appendChild(list);
        }
      }

      if (nowPlayingStatus) nowPlayingStatus.textContent = isPlaying ? 'Playing' : 'Paused';

      if (nowPlayingToggleButton) {
        nowPlayingToggleButton.textContent = isPlaying ? '⏸' : '▶';
        nowPlayingToggleButton.setAttribute('aria-label', isPlaying ? 'Pause playback' : 'Play track');
        nowPlayingToggleButton.disabled = !meta.src;
      }

      if (nowPlayingProgressFill) {
        nowPlayingProgressFill.style.width = '0%';
      }

      if (nowPlayingCollapseButton) {
        nowPlayingCollapseButton.textContent = nowPlayingCollapsed ? 'Show info' : 'Hide info';
      }

      if (nowPlayingThumb) {
        nowPlayingThumb.innerHTML = '';
        if (meta.picture) {
          const raw = String(meta.picture || '');
          const artSrc = raw.startsWith('/api/container?') || /^https?:/i.test(raw)
            ? raw
            : `/api/container?u=${encodeURIComponent(raw)}`;
          const img = document.createElement('img');
          img.src = artSrc;
          img.alt = 'Artwork';
          img.loading = 'lazy';
          img.onerror = () => { nowPlayingThumb.innerHTML = 'No art'; };
          nowPlayingThumb.appendChild(img);
        } else {
          nowPlayingThumb.textContent = 'No art';
        }
      }
    }

    function setNowPlayingFromRow(row, isPlaying){
      const meta = getMetaFromRow(row);
      if (!meta) {
        nowPlayingInfo.meta = null;
        nowPlayingInfo.isPlaying = false;
      } else {
        if (!nowPlayingInfo.meta) nowPlayingCollapsed = false;
        nowPlayingInfo.meta = meta;
        nowPlayingInfo.isPlaying = !!isPlaying;
      }
      updateNowPlayingUI();
      syncPlaylistOnlyCurrent();
    }

    function markNowPlayingInactive(){
      if (nowPlayingInfo.meta) {
        nowPlayingInfo.isPlaying = false;
        updateNowPlayingUI();
        syncPlaylistOnlyCurrent();
      }
    }

    function clearNowPlaying(){
      nowPlayingInfo.meta = null;
      nowPlayingInfo.isPlaying = false;
      nowPlayingCollapsed = false;
      updateNowPlayingUI();
      syncPlaylistOnlyCurrent();
    }

    function syncPlaylistOnlyCurrent(){
      if (!playlistTracksSection) return;
      const should = Boolean(nowPlayingInfo.meta && nowPlayingInfo.isPlaying && nowPlayingInfo.meta.playlistId === activePlaylistId);
      playlistTracksSection.classList.toggle('only-current', should);
    }

    function clearPlaylists(){
      playlists = [];
      playlistsLoaded = false;
      playlistsLoading = false;
      activePlaylistId = null;
      /* keep collapsed by default */ playlistTracksCollapsed = playlistTracksCollapsed;
      clearNowPlaying();
      renderPlaylistsPanel();
    }

    async function loadUserPlaylists(){
      if (!currentUser) {
        clearPlaylists();
        return [];
      }
      if (playlistsLoading) return playlists;
      playlistsLoading = true;
      try {
        const res = await fetch('/api/playlists', { headers: { 'Accept': 'application/json' } });
        if (res.status === 401) {
          currentUser = null;
          clearPlaylists();
          updateAuthUI();
          return [];
        }
        if (!res.ok) throw new Error('Failed to load playlists');
        const json = await res.json().catch(() => ({}));
        playlists = Array.isArray(json?.playlists) ? json.playlists : [];
        playlistsLoaded = true;
        if (!playlists.length) {
          activePlaylistId = null;
        } else if (!activePlaylistId || !playlists.some((p) => p && p.id === activePlaylistId)) {
          activePlaylistId = playlists[0]?.id || null;
        }
        /* keep collapsed by default */ playlistTracksCollapsed = playlistTracksCollapsed;
        renderPlaylistsPanel();
        return playlists;
      } catch (err) {
        console.warn('Playlist fetch failed:', err);
        playlistsLoaded = false;
        renderPlaylistsPanel();
        return [];
      } finally {
        playlistsLoading = false;
        renderPlaylistsPanel();
      }
    }

    async function ensurePlaylistsLoaded(){
      if (!playlistsLoaded) {
        await loadUserPlaylists();
      } else {
        renderPlaylistsPanel();
      }
      return playlists;
    }

    async function createPlaylistOnServer(name){
      const trimmed = typeof name === 'string' ? name.trim() : '';
      if (!trimmed) throw new Error('Playlist name required');
      const res = await fetch('/api/playlists', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ name: trimmed })
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409 && json?.playlist) {
        playlists = Array.isArray(playlists) ? playlists : [];
        const existing = json.playlist;
        const idx = playlists.findIndex((p) => p && p.id === existing.id);
        if (idx === -1) playlists.push(existing);
        playlistsLoaded = true;
        activePlaylistId = existing?.id || activePlaylistId;
        renderPlaylistsPanel();
        return existing;
      }
      if (res.status === 401) {
        currentUser = null;
        clearPlaylists();
        updateAuthUI();
        throw new Error('Please log in to manage playlists');
      }
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to create playlist');
      }
      const playlist = json.playlist;
      playlists = Array.isArray(playlists) ? playlists.slice() : [];
      playlists.push(playlist);
      playlistsLoaded = true;
      activePlaylistId = playlist?.id || activePlaylistId;
      renderPlaylistsPanel();
      return playlist;
    }

    async function addTrackToPlaylistOnServer(playlistId, trackPayload){
      const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/tracks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ track: trackPayload })
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) {
        currentUser = null;
        clearPlaylists();
        updateAuthUI();
        throw new Error('Please log in to manage playlists');
      }
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to add track to playlist');
      }
      const updated = json.playlist;
      const track = json.track;
      const idx = playlists.findIndex((p) => p && p.id === updated?.id);
      if (idx !== -1) {
        playlists[idx] = updated;
      } else if (updated) {
        playlists.push(updated);
      }
      playlistsLoaded = true;
      activePlaylistId = updated?.id || activePlaylistId;
      renderPlaylistsPanel();
      return { playlist: updated, track, duplicate: json.duplicate }; // duplicate flag optional
    }

    async function addAlbumToPlaylistOnServer(playlistId, tracksPayload){
      const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/tracks/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ tracks: tracksPayload })
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) {
        currentUser = null;
        clearPlaylists();
        updateAuthUI();
        throw new Error('Please log in to manage playlists');
      }
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to add album to playlist');
      }
      const updated = json.playlist;
      const idx = playlists.findIndex((p) => p && p.id === updated?.id);
      if (idx !== -1) {
        playlists[idx] = updated;
      } else if (updated) {
        playlists.push(updated);
      }
      playlistsLoaded = true;
      activePlaylistId = updated?.id || activePlaylistId;
      renderPlaylistsPanel();
      return json;
    }

    function getActivePlaylist(){
      if (!activePlaylistId) return null;
      return playlists.find((p) => p && p.id === activePlaylistId) || null;
    }

    function setActivePlaylist(id){
      if (!id || !playlists.some((p) => p && p.id === id)) {
        activePlaylistId = null;
        /* keep collapsed by default */ playlistTracksCollapsed = playlistTracksCollapsed;
      } else {
        if (activePlaylistId !== id) /* keep collapsed by default */ playlistTracksCollapsed = playlistTracksCollapsed;
        activePlaylistId = id;
      }
      renderPlaylistsPanel();
    }

    function renderPlaylistsPanel(){
      if (!playlistsPanel) return;
      const hasUser = Boolean(currentUser);
      const list = Array.isArray(playlists) ? playlists.filter(Boolean) : [];

      if (playlistColumn) playlistColumn.hidden = !hasUser;

      if (!hasUser) {
        playlistsPanel.hidden = true;
        renderPlaylistTracks();
        return;
      }

      playlistsPanel.hidden = false;

      if (playlistsStatus) {
        if (playlistsLoading) playlistsStatus.textContent = 'Loading…';
        else playlistsStatus.textContent = list.length ? `${list.length} playlist${list.length === 1 ? '' : 's'}` : 'No playlists yet';
      }

      if (playlistsList) {
        playlistsList.innerHTML = '';
        list.forEach((pl) => {
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'playlist-pill';
          if (pl.id === activePlaylistId) pill.classList.add('active');
          pill.dataset.playlistId = pl.id || '';

          const count = Array.isArray(pl.tracks) ? pl.tracks.length : 0;
          const countLabel = count ? `${count} track${count === 1 ? '' : 's'}` : 'Empty';
          const label = pl.name ? `${pl.name} • ${countLabel}` : countLabel;
          pill.textContent = label;

          pill.addEventListener('click', () => {
            if (pl.id === activePlaylistId) setActivePlaylist(null);
            else setActivePlaylist(pl.id);
          });

          playlistsList.appendChild(pill);
        });
      }

      if (playlistsEmpty) {
        playlistsEmpty.hidden = list.length > 0 || playlistsLoading;
      }

      if (playlistCreateForm) {
        playlistCreateForm.hidden = false;
      }

      renderPlaylistTracks();
      updateNowPlayingUI();
    }

    function renderPlaylistTracks(){
      if (!playlistTracksSection) return;
      const hasUser = Boolean(currentUser);
      const playlist = getActivePlaylist();

    if (!hasUser) {
      playlistTracksSection.hidden = true;
      if (deletePlaylistButton) deletePlaylistButton.hidden = true;
      if (togglePlaylistTracksButton) togglePlaylistTracksButton.hidden = true;
      if (sharePlaylistButton) sharePlaylistButton.hidden = true;
      if (shareLinkOutput) updateShareLinkDisplay(null);
      return;
    }

    if (!playlist) {
      /* keep collapsed by default */ playlistTracksCollapsed = playlistTracksCollapsed;
      if (playlistTracksTitle) playlistTracksTitle.textContent = 'Playlist';
      if (playlistTracksMeta) playlistTracksMeta.textContent = '';
      if (playlistTracksList) playlistTracksList.innerHTML = '';
      if (playlistTracksEmpty) playlistTracksEmpty.hidden = true;
      if (deletePlaylistButton) deletePlaylistButton.hidden = true;
      if (togglePlaylistTracksButton) togglePlaylistTracksButton.hidden = true;
      if (sharePlaylistButton) sharePlaylistButton.hidden = true;
      if (shareLinkOutput) updateShareLinkDisplay(null);
      playlistTracksSection.hidden = true;
      return;
    }

    playlistTracksSection.hidden = false;
      playlistTracksSection.classList.toggle('collapsed', playlistTracksCollapsed);

      const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
      const count = tracks.length;

      if (playlistTracksTitle) playlistTracksTitle.textContent = playlist.name || 'Playlist';
      if (playlistTracksMeta) {
        const countText = count ? `${count} track${count === 1 ? '' : 's'}` : 'No tracks yet';
        let display = countText;
        if (playlistTracksCollapsed && count) display += ' • hidden';
        playlistTracksMeta.textContent = display;
        playlistTracksMeta.hidden = false;
      }

      if (deletePlaylistButton) {
        deletePlaylistButton.hidden = false;
        deletePlaylistButton.disabled = playlistsLoading;
      }

      if (sharePlaylistButton) {
        sharePlaylistButton.hidden = false;
        const hasTracks = count > 0;
        sharePlaylistButton.disabled = playlistsLoading || !hasTracks;
        if (!hasTracks) {
          sharePlaylistButton.title = 'Add at least one track before sharing a playlist';
        } else {
          sharePlaylistButton.title = '';
        }
      }

      updateShareLinkDisplay(playlist);

      if (togglePlaylistTracksButton) {
        const hideToggle = count === 0;
        togglePlaylistTracksButton.hidden = hideToggle;
        if (!hideToggle) {
          togglePlaylistTracksButton.textContent = playlistTracksCollapsed ? 'Show tracks' : 'Hide tracks';
        }
      }

      if (playlistTracksList) {
        const previousPlaylistState = (currentRow && currentRow._playlist)
          ? {
              playlistId: currentRow._playlist,
              src: currentRow._src,
              playing: !player.paused && currentSrc === currentRow._src
            }
          : null;
        let matchedPlayback = false;

        playlistTracksList.innerHTML = '';

        tracks.forEach((track, idx) => {
          const li = document.createElement('li');
          li.className = 'track playlist-track';

          const btnPlay = document.createElement('button');
          btnPlay.type = 'button';
          btnPlay.className = 'btn track-play';
          const srcCandidate = track?.resolvedSrc || track?.mp3 || '';
          const audioField = typeof track?.audioField === 'string' ? track.audioField.trim() : '';
          const artworkField = typeof track?.artworkField === 'string' ? track.artworkField.trim() : '';
          const playableCandidate = resolvePlayableSrc(srcCandidate || track?.mp3 || '');
          const playableSrc = canValidateAudioSrc(playableCandidate) ? playableCandidate : '';
          li._src = playableSrc;
          li._btn = btnPlay;
          li._card = null;
          li._playlist = playlist.id;
          li._audioField = audioField;
          li._valid = null;
          li._validated = false;
          li._validating = false;
          if (track?.id) li.dataset.trackId = track.id;
          else if (track?.trackRecordId) li.dataset.trackId = track.trackRecordId;

          const trackName = track?.name || 'Untitled track';
          const artist = (track?.trackArtist || track?.albumArtist || '').trim();

          btnPlay.dataset.playLabel = '▶';
          btnPlay.dataset.pauseLabel = '⏸';
          const readable = artist ? `${artist} — ${trackName}` : trackName;
          btnPlay.dataset.playAria = `Play ${readable}`;
          btnPlay.dataset.pauseAria = `Pause ${readable}`;

          if (playableSrc) {
            btnPlay.textContent = btnPlay.dataset.playLabel;
            btnPlay.disabled = false;
            btnPlay.classList.remove('btn-error');
            btnPlay.setAttribute('aria-label', btnPlay.dataset.playAria);
          } else {
            btnPlay.textContent = 'No audio';
            btnPlay.disabled = true;
            btnPlay.classList.add('btn-error');
            btnPlay.setAttribute('aria-label', `Audio unavailable for ${readable}`);
          }

          btnPlay.addEventListener('click', async () => {
            if (!li._src) {
              window.alert('This track has no playable audio source.');
              return;
            }
            if (li._valid === false) {
              btnPlay.textContent = 'Unavailable';
              btnPlay.disabled = true;
              btnPlay.classList.add('btn-error');
              btnPlay.setAttribute('aria-label', `Audio unavailable for ${readable}`);
              return;
            }

            if (li._playlist && track?.trackRecordId) {
              const previousLabel = btnPlay.textContent;
              btnPlay.disabled = true;
              btnPlay.textContent = 'Refreshing…';
              btnPlay.setAttribute('aria-label', `Refreshing audio for ${readable}`);
              const oldKey = String(li._src || '').trim();
              if (oldKey) audioProbeCache.delete(oldKey);
              const refreshed = await refreshTrackContainerSource(li, {
                recordId: track.trackRecordId,
                audioField: audioField,
                candidates: AUDIO_FIELD_CANDIDATES,
                forceRefresh: true
              });
              btnPlay.disabled = false;
              btnPlay.textContent = previousLabel;
              if (btnPlay.dataset.playAria) {
                if (btnPlay.textContent === btnPlay.dataset.playLabel) {
                  btnPlay.setAttribute('aria-label', btnPlay.dataset.playAria);
                } else if (btnPlay.dataset.pauseAria && btnPlay.textContent === btnPlay.dataset.pauseLabel) {
                  btnPlay.setAttribute('aria-label', btnPlay.dataset.pauseAria);
                }
              }
              if (refreshed?.notFound) {
                li._src = '';
                li._meta.src = '';
                li._valid = false;
                btnPlay.textContent = 'Unavailable';
                btnPlay.disabled = true;
                btnPlay.classList.add('btn-error');
                btnPlay.setAttribute('aria-label', `Audio unavailable for ${readable}`);
                return;
              }
              if (refreshed && refreshed.src) {
                const newSrc = refreshed.src;
                li._src = newSrc;
                li._meta.src = newSrc;
                if (refreshed.audioField) {
                  li._audioField = refreshed.audioField;
                  li._meta.audioField = refreshed.audioField;
                }
                if (track) {
                  track.resolvedSrc = refreshed.src;
                  track.mp3 = refreshed.rawUrl;
                  if (refreshed.audioField) track.audioField = refreshed.audioField;
                }
              }
            }

            handlePlay(btnPlay, li, li._src);

            if (li._valid === true || li._validating) return;
            li._validating = true;
            validateAudio(li, li._src, { optimistic: true }).finally(() => {
              li._validating = false;
            });
          });

          const wrapper = document.createElement('span');
          wrapper.className = 'track-name';

          if (artist) {
            const artistLine = document.createElement('span');
            artistLine.className = 'track-name-artist';
            artistLine.textContent = artist;
            wrapper.appendChild(artistLine);

            const titleLine = document.createElement('span');
            titleLine.className = 'track-name-title';
            titleLine.textContent = trackName;
            wrapper.appendChild(titleLine);
          } else {
            const titleLine = document.createElement('span');
            titleLine.className = 'track-name-title';
            titleLine.textContent = trackName;
            wrapper.appendChild(titleLine);
          }

          const tooltipParts = [artist, track?.albumTitle, track?.albumArtist].filter((part) => typeof part === 'string' && part.trim());
          if (tooltipParts.length) {
            const tooltip = tooltipParts.join(' • ');
            wrapper.title = tooltip;
            li.title = tooltip;
          }

          li.appendChild(btnPlay);
          li.appendChild(wrapper);

          const baseMeta = { ...track };
          baseMeta.trackName = trackName;
          baseMeta.trackArtist = track?.trackArtist || track?.albumArtist || '';
          baseMeta.albumTitle = track?.albumTitle || '';
          baseMeta.albumArtist = track?.albumArtist || '';
          baseMeta.playlistId = playlist.id;
          baseMeta.playlistName = playlist.name || '';
          baseMeta.picture = track?.artwork || '';
          baseMeta.source = 'playlist';
          baseMeta.catalogue = track?.catalogue || '';
          baseMeta.playlistTrackId = track?.id || '';
          baseMeta.trackRecordId = track?.trackRecordId || '';
          baseMeta.audioField = audioField;
          baseMeta.pictureField = artworkField;
          baseMeta.src = playableSrc;
          baseMeta.producer = track?.producer || '';
          baseMeta.composer1 = track?.composer1 || '';
          baseMeta.composer2 = track?.composer2 || '';
          baseMeta.composer3 = track?.composer3 || '';
          baseMeta.composer4 = track?.composer4 || '';
          baseMeta.composers = track?.composers || [];
          li._meta = baseMeta;
          playlistTracksList.appendChild(li);

          if (
            playableSrc &&
            previousPlaylistState &&
            previousPlaylistState.playlistId === playlist.id &&
            previousPlaylistState.src === playableSrc
          ) {
            matchedPlayback = true;
            currentRow = li;
            currentBtn = btnPlay;
            li._playlist = playlist.id;
            if (previousPlaylistState.playing) {
              li.classList.add('playing');
              btnPlay.textContent = btnPlay.dataset.pauseLabel || '⏸ Pause';
              btnPlay.classList.add('btn-accent');
              btnPlay.disabled = false;
              if (btnPlay.dataset.pauseAria) btnPlay.setAttribute('aria-label', btnPlay.dataset.pauseAria);
            } else {
              btnPlay.textContent = btnPlay.dataset.playLabel || '▶ Play';
              btnPlay.classList.remove('btn-accent');
              if (btnPlay.dataset.playAria) btnPlay.setAttribute('aria-label', btnPlay.dataset.playAria);
            }
            setNowPlayingFromRow(li, previousPlaylistState.playing);
          }
        });

        if (previousPlaylistState) {
          if (previousPlaylistState.playlistId === playlist.id) {
            if (!matchedPlayback) {
              if (previousPlaylistState.playing && !player.paused && currentSrc === previousPlaylistState.src) {
                player.pause();
              }
              currentSrc = '';
              updateButtonsForStop();
            } else {
              updateProgressUI();
            }
          } else if (previousPlaylistState.playing && !player.paused && currentSrc === previousPlaylistState.src) {
            player.pause();
            currentSrc = '';
            updateButtonsForStop();
          }
        }

        playlistTracksList.hidden = playlistTracksCollapsed;
      }

      if (playlistTracksEmpty) {
        playlistTracksEmpty.hidden = playlistTracksCollapsed || count > 0;
        playlistTracksEmpty.textContent = 'No tracks in this playlist yet.';
      }
      syncPlaylistOnlyCurrent();
    }

    async function deletePlaylistOnServer(id){
      const res = await fetch(`/api/playlists/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
          'Accept': 'application/json'
        }
      });
      let json = {};
      try { json = await res.json(); } catch {}
      if (res.status === 401) {
        currentUser = null;
        clearPlaylists();
        updateAuthUI();
        throw new Error('Please log in to manage playlists');
      }
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to delete playlist');
      }
      return json?.playlist || null;
    }

    async function deleteActivePlaylist(){
      const playlist = getActivePlaylist();
      if (!playlist) return;
      const name = playlist.name || 'playlist';
      if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
      if (deletePlaylistButton) deletePlaylistButton.disabled = true;
      try {
        await deletePlaylistOnServer(playlist.id);
      } catch (err) {
        window.alert(err?.message || 'Unable to delete playlist');
        if (deletePlaylistButton) deletePlaylistButton.disabled = false;
        return;
      }
      playlists = Array.isArray(playlists) ? playlists.filter((p) => p && p.id !== playlist.id) : [];
      playlistsLoaded = true;
      if (playlists.length) {
        activePlaylistId = playlists[0]?.id || null;
      } else {
        activePlaylistId = null;
      }
      if (nowPlayingInfo.meta && nowPlayingInfo.meta.playlistId === playlist.id) {
        try { player.pause(); } catch {}
        updateButtonsForStop();
        currentSrc = '';
        clearNowPlaying();
      }
      /* keep collapsed by default */ playlistTracksCollapsed = playlistTracksCollapsed;
      renderPlaylistsPanel();
      if (deletePlaylistButton) deletePlaylistButton.disabled = false;
      window.alert('Playlist deleted.');
    }

    function buildShareUrlFallback(shareId){
      const normalized = typeof shareId === 'string' ? shareId.trim() : '';
      if (!normalized) return '';
      try {
        const current = new URL(window.location.href);
        const base = `${current.origin}${current.pathname}`;
        return `${base}?share=${encodeURIComponent(normalized)}`;
      } catch {
        const origin = (window.location && window.location.origin) || '';
        const path = (window.location && window.location.pathname) || '/';
        const base = origin ? `${origin}${path}` : path;
        return `${base}?share=${encodeURIComponent(normalized)}`;
      }
    }

    async function copyTextToClipboard(text){
      if (!text) return false;
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch (err) {
        console.warn('[MASS] Clipboard write failed', err);
      }
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return true;
      } catch (err) {
        console.warn('[MASS] Fallback clipboard copy failed', err);
      }
      window.prompt('Copy this link:', text);
      return false;
    }

    function getExistingShareUrl(playlist){
      if (!playlist || typeof playlist !== 'object') return '';
      const shareId = typeof playlist.shareId === 'string' ? playlist.shareId.trim() : '';
      if (!shareId) return '';
      return buildShareUrlFallback(shareId);
    }

    function updateShareLinkDisplay(playlist, explicitUrl){
      if (!shareLinkOutput) return;
      const url = explicitUrl || getExistingShareUrl(playlist);
      if (url) {
        shareLinkOutput.hidden = false;
        shareLinkOutput.textContent = `Share link: ${url}`;
        shareLinkOutput.dataset.url = url;
      } else {
        shareLinkOutput.hidden = true;
        shareLinkOutput.textContent = '';
        shareLinkOutput.removeAttribute('data-url');
      }
    }

    async function copyActivePlaylistShareLink(){
      const playlist = getActivePlaylist();
      if (!playlist) return;
      if (!Array.isArray(playlist.tracks) || playlist.tracks.length === 0) {
        window.alert('Add tracks before sharing a playlist.');
        return;
      }
      if (sharePlaylistButton) {
        sharePlaylistButton.disabled = true;
      }
      try {
        const res = await fetch(`/api/playlists/${encodeURIComponent(playlist.id)}/share`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({})
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          currentUser = null;
          clearPlaylists();
          updateAuthUI();
          throw new Error('Please log in to manage playlists');
        }
        if (res.status === 400) {
          throw new Error(data?.error || 'Add at least one track before sharing');
        }
        if (!res.ok || !data?.ok) {
          const detail = typeof data?.detail === 'string' && data.detail.trim() ? data.detail.trim() : '';
          const message = typeof data?.error === 'string' && data.error.trim() ? data.error.trim() : 'Unable to generate share link';
          throw new Error(detail || message);
        }
        const shareId = typeof data.shareId === 'string'
          ? data.shareId.trim()
          : typeof data.playlist?.shareId === 'string'
            ? data.playlist.shareId.trim()
            : '';
        if (!shareId) {
          throw new Error('Server did not return a share link');
        }
        const shareUrl = (typeof data.shareUrl === 'string' && data.shareUrl.trim())
          ? data.shareUrl.trim()
          : buildShareUrlFallback(shareId);
        const serverSharedAt = typeof data.playlist?.sharedAt === 'string'
          ? data.playlist.sharedAt
          : playlist.sharedAt || new Date().toISOString();
        playlist.shareId = shareId;
        playlist.sharedAt = serverSharedAt;
        const idx = playlists.findIndex((p) => p && p.id === playlist.id);
        if (idx !== -1) {
          const current = playlists[idx];
          playlists[idx] = {
            ...current,
            shareId,
            sharedAt: serverSharedAt
          };
        }
        const updatedPlaylist = idx !== -1 ? playlists[idx] : { ...playlist };
        updateShareLinkDisplay(updatedPlaylist, shareUrl);

        // Show share modal with link
        showShareModal(shareUrl);
      } catch (err) {
        console.error('Copy share link failed', err);
        const existingShareId = typeof playlist.shareId === 'string' ? playlist.shareId.trim() : '';
        if (existingShareId) {
          const fallbackUrl = buildShareUrlFallback(existingShareId);
          updateShareLinkDisplay(playlist, fallbackUrl);
          showShareModal(fallbackUrl);
        } else {
          window.alert(err?.message || 'Unable to generate share link');
        }
      } finally {
        if (sharePlaylistButton) {
          sharePlaylistButton.disabled = false;
        }
      }
    }

    function buildPlaylistTrackPayload(album, track, playableSrc){
      const recordId = track?.recordId;
      return {
        recordId: typeof recordId === 'string' ? recordId : recordId ? String(recordId) : '',
        name: track?.name || '',
        albumTitle: album?.title || '',
        albumArtist: album?.artist || '',
        catalogue: album?.catalogue || '',
        trackArtist: track?.trackArtist || '',
        seq: Number.isFinite(track?.seq) ? Number(track.seq) : null,
        mp3: track?.mp3 || '',
        resolvedSrc: playableSrc || '',
        artwork: album?.picture || '',
        audioField: track?.mp3Field || track?.audioField || '',
        artworkField: album?.pictureField || track?.pictureField || ''
      };
    }

    async function resolvePlaylistForAdd(){
      if (!currentUser) {
        openAuth('login');
        return null;
      }

      await ensurePlaylistsLoaded();
      playlists = Array.isArray(playlists) ? playlists : [];

      let playlist = getActivePlaylist();
      if (!playlist && playlists.length === 1) {
        playlist = playlists[0];
      }

      if (!playlist) {
        let name = window.prompt('Add to playlist\nEnter playlist name (existing names will be reused):');
        if (typeof name !== 'string') return null;
        name = name.trim();
        if (!name) return null;

        const existing = playlists.find((p) => typeof p?.name === 'string' && p.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          playlist = existing;
        } else {
          try {
            playlist = await createPlaylistOnServer(name);
          } catch (err) {
            window.alert(err?.message || 'Unable to create playlist');
            return null;
          }
        }
      }

      if (!playlist) return null;

      /* keep collapsed by default */ playlistTracksCollapsed = playlistTracksCollapsed;
      const playlistId = playlist?.id || null;
      if (playlistId && playlistId !== activePlaylistId) {
        setActivePlaylist(playlistId);
      } else {
        renderPlaylistsPanel();
      }

      return playlist;
    }

    async function handleAddToPlaylist(album, track, playableSrc){
      const playlist = await resolvePlaylistForAdd();
      if (!playlist) return;

      const payload = buildPlaylistTrackPayload(album, track, playableSrc);
      if (!payload.name) {
        window.alert('Track must have a name before it can be added.');
        return;
      }

      try {
        const { duplicate } = await addTrackToPlaylistOnServer(playlist.id, payload);
        if (duplicate) {
          window.alert('Track already in playlist.');
        } else {
          window.alert(`Added to "${playlist.name}"`);
        }
      } catch (err) {
        window.alert(err?.message || 'Unable to add track');
      }
    }

    async function handleAddAlbumToPlaylist(album){
      const playlist = await resolvePlaylistForAdd();
      if (!playlist) return;

      const tracks = Array.isArray(album?.tracks) ? album.tracks.filter(t => t.hasValidAudio) : [];
      const payloads = tracks
        .map((track) => {
          const candidate = resolvePlayableSrc(track?.mp3 || '');
          const playableSrc = canValidateAudioSrc(candidate) ? candidate : '';
          return buildPlaylistTrackPayload(album, track, playableSrc);
        })
        .filter((payload) => payload.name);

      if (!payloads.length) {
        window.alert('No tracks on this album could be added.');
        return;
      }

      try {
        const result = await addAlbumToPlaylistOnServer(playlist.id, payloads);
        const addedCount = Number(result?.addedCount) || 0;
        const duplicateCount = Number(result?.duplicateCount) || 0;
        const skippedCount = Number(result?.skippedCount) || 0;

        let message = addedCount > 0
          ? `Added ${addedCount} track${addedCount === 1 ? '' : 's'} to "${playlist.name}".`
          : `No new tracks added to "${playlist.name}".`;
        if (duplicateCount > 0) message += ` ${duplicateCount} already in playlist.`;
        if (skippedCount > 0) message += ` ${skippedCount} skipped.`;
        window.alert(message);
      } catch (err) {
        window.alert(err?.message || 'Unable to add album to playlist');
      }
    }

    function openAuth(mode = authMode, trigger = null){
      setAuthMode(mode);
      clearAuthError();
      if (authOverlay) {
        authOverlay.hidden = false;
        authOverlay.classList.add('open');
      }
      authReturnFocus = trigger || document.activeElement;
      queueTask(() => {
        authEmail?.focus();
        authEmail?.select?.();
      });
    }

    function closeAuth(){
      if (authOverlay) {
        authOverlay.hidden = true;
        authOverlay.classList.remove('open');
      }
      setAuthBusy(false);
      clearAuthError();
      authForm?.reset();
      if (authReturnFocus && typeof authReturnFocus.focus === 'function') {
        authReturnFocus.focus();
      }
      authReturnFocus = null;
      setAuthMode('login');
    }

    function showShareModal(link) {
      if (!shareModal || !shareLinkInput) return;
      shareLinkInput.value = link;
      shareModal.classList.add('open');
      // Auto-select the text for easy copying
      setTimeout(() => {
        shareLinkInput.focus();
        shareLinkInput.select();
      }, 100);
    }

    function closeShareModal() {
      if (!shareModal) return;
      shareModal.classList.remove('open');
      shareLinkInput.value = '';
    }

    async function refreshCurrentUser(){
      try {
        const res = await fetch('/api/auth/me', { headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error('Session check failed');
        const json = await res.json().catch(() => ({}));
        const email = json?.user?.email;
        currentUser = email ? { email } : null;
      } catch {
        currentUser = null;
      }
      if (currentUser) {
        await loadUserPlaylists();
        // Also load featured playlists
        loadPublicPlaylistSummaries().catch(err => console.warn('Failed to load featured playlists:', err));
      } else {
        clearPlaylists();
      }
      updateAuthUI();
    }

    async function submitAuthForm(event){
      event.preventDefault();
      if (!authEmail || !authPassword) return;
      const email = authEmail.value.trim();
      const password = authPassword.value;
      if (!email) {
        setAuthError('Email required');
        authEmail.focus();
        return;
      }
      if (password.length < 8) {
        setAuthError('Password must be at least 8 characters');
        authPassword.focus();
        return;
      }
      clearAuthError();
      setAuthBusy(true);
      try {
        const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ email, password })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) {
          const message = json?.error || 'Unable to complete request';
          setAuthError(message);
          return;
        }
        currentUser = json?.user?.email ? { email: json.user.email } : { email };
        updateAuthUI();
        await loadUserPlaylists();
        closeAuth();
      } catch (err) {
        setAuthError(err?.message || 'Network error');
      } finally {
        setAuthBusy(false);
      }
    }

    async function performLogout(){
      setAuthBusy(true);
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Accept': 'application/json' }
        });
      } catch {}
      currentUser = null;
      setAuthBusy(false);
      updateAuthUI();
      clearPlaylists();
    }


    // Raw FM rows (cumulative as we lazy-load)
    let rawItems = [];
    let rawTotalFound = 0;
    let rawNextOffset = 0; // UI 0-based; server converts to FM 1-based

    // Grouped albums & album-page state
    let albumGroups = [];
    let albumPage = 0;
    let currentMode = 'landing';
    let currentExploreDecade = null; // Track current decade for reload
    let shouldScrollAlbums = false;
    let isRestoring = false;
    let showAlbumsWithoutAudio = true; // Show all albums, trust FileMaker data

    // Single audio UI state
    let currentBtn=null, currentRow=null, currentSrc='';

    // Audio validation caches
    const audioProbeCache = new Map(); // src -> { ok, reason, ts }
    const albumAudioState = new Map(); // albumKey -> { status, promise?, ts }
    const AUDIO_PROBE_TTL = 10 * 60 * 1000;
    const queueTask = typeof queueMicrotask === 'function' ? queueMicrotask : (fn) => Promise.resolve().then(fn);
    const containerCache = new Map(); // recordId|field -> cached container

    // Field helper mappings (adjust here if exact names differ)
    const AUDIO_FIELD_CANDIDATES = ['mp3', 'MP3', 'Audio File', 'Audio::mp3'];
    const ARTWORK_FIELD_CANDIDATES = ['Artwork::Picture', 'Artwork Picture', 'Picture'];
    const TRACK_TITLE_CANDIDATES = ['Track Name', 'Song Name', 'Title', 'Track Title', 'Song Title'];
    const PUBLIC_PLAYLIST_FIELD_CANDIDATES = [
      'PublicPlaylist',
      'Public Playlist',
      'Tape Files::PublicPlaylist',
      'Tape Files::Public Playlist',
      'Public_Playlist',
      'Playlist Name',
      'Playlist::Public'
    ];

    function pickFieldValue(source, candidates){
      if (!source) return { value: '', field: '' };
      const entries = Object.entries(source);
      const normalizeFieldName = (name) => typeof name === 'string' ? name.replace(/[^a-z0-9]/gi, '').toLowerCase() : '';
      for (const candidate of candidates) {
        for (const [key, raw] of entries) {
          if (key !== candidate) continue;
          if (raw === undefined || raw === null) continue;
          const str = typeof raw === 'string' ? raw.trim() : String(raw).trim();
          if (str) return { value: str, field: key };
        }
        const normalizedCandidate = normalizeFieldName(candidate);
        if (!normalizedCandidate) continue;
        for (const [key, raw] of entries) {
          if (key === candidate) continue;
          if (raw === undefined || raw === null) continue;
          if (normalizeFieldName(key) !== normalizedCandidate) continue;
          const str = typeof raw === 'string' ? raw.trim() : String(raw).trim();
          if (str) return { value: str, field: key };
        }
      }
      return { value: '', field: '' };
        }

    function fCatalogue(f){
      return f['Album Catalogue Number'] || f['Album Catalog Number'] || f['Album Catalogue No'] || f['Catalogue'] || '';
        }
    function fPicture(f){
      return pickFieldValue(f, ARTWORK_FIELD_CANDIDATES).value;
        }
    const F_TRACK  = 'Track Name';
    const F_GENRE  = 'Local Genre';

    const TRACK_SEQUENCE_FIELDS = [
      'Track Number',
      'TrackNumber',
      'Track_Number',
      'Track No',
      'Track No.',
      'Track_No',
      'Track #',
      'Track#',
      'Track Sequence',
      'Track Sequence Number',
      'Track Seq',
      'Track Seq No',
      'Track Order',
      'Track Position',
      'TrackPosition',
      'Sequence',
      'Seq',
      'Sequence Number',
      'Sequence_Number',
      'Song Number',
      'Song No',
      'Song Seq',
      'Song Order',
      'Tape Files::Track Number',
      'Tape Files::Track_No'
    ];

    function composersFrom(f){
      const c = [
        f['Composer'],
        f['Composer 1'] ?? f['Composer1'],
        f['Composer 2'] ?? f['Composer2'],
        f['Composer 3'] ?? f['Composer3'],
        f['Composer 4'] ?? f['Composer4'],
      ].filter(Boolean);
      return c;
        }

    function parseTrackSequence(fields = {}) {
      for (const key of TRACK_SEQUENCE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
        const raw = fields[key];
        if (raw === undefined || raw === null) continue;
        const str = String(raw).trim();
        if (!str) continue;
        const numeric = Number(str);
        if (Number.isFinite(numeric)) return numeric;
        const cleaned = Number(str.replace(/[^0-9.-]/g, ''));
        if (Number.isFinite(cleaned)) return cleaned;
      }
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined || value === null) continue;
        const lower = key.toLowerCase();
        if (!/(track|song)/.test(lower)) continue;
        if (!/(no|num|#|seq|order|pos)/.test(lower)) continue;
        const str = String(value).trim();
        if (!str) continue;
        const numeric = Number(str);
        if (Number.isFinite(numeric)) return numeric;
        const cleaned = Number(str.replace(/[^0-9.-]/g, ''));
        if (Number.isFinite(cleaned)) return cleaned;
      }
      return Number.POSITIVE_INFINITY;
        }

    
    // Flexible field accessors to match your layout keys
    function fTitle(f){
      return f['Album Title'] || f['Tape Files::Album_Title'] || f['Album_Title'] || f['Title'] || '';
        }
    function fArtist(f){
      return f['Album Artist'] || f['Tape Files::Album Artist'] || f['Track Artist'] || f['Artist'] || '';
        }
    function fMp3(f){
      return pickFieldValue(f, AUDIO_FIELD_CANDIDATES).value;
        }
    function fLang(f){
      return f['Language'] || f['Language Code'] || '';
        }

    function hasValidMp3(s){
      return canValidateAudioSrc(s);
        }

    function fmtTime(sec){
      const value = Number(sec);
      if (!Number.isFinite(value) || value <= 0) return '0:00';
      const clamped = Math.max(0, value);
      const minutes = Math.floor(clamped / 60);
      const seconds = Math.floor(clamped % 60);
      return `${minutes}:${String(seconds).padStart(2,'0')}`;
        }

    function formatDateForDisplay(iso){
      if (typeof iso !== 'string' || !iso.trim()) return '';
      try {
        const date = new Date(iso);
        if (!Number.isFinite(date.getTime())) return '';
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      } catch {
        return '';
      }
        }

    const AUDIO_VALIDATE_TIMEOUT = 12000;
    const AUDIO_VALIDATE_MAX_RETRIES = 2;
    const MAX_AUDIO_PROBES_PER_ALBUM = 2;
    const MAX_ALBUMS_TO_PRIME = ALBUMS_PER_PAGE * 2;
    const MAX_CONCURRENT_AUDIO_PROBES = 6;
    const AUDIO_PRELOAD_LIMIT = 4;
    let activeAudioProbes = 0;
    const audioProbeWaiters = [];
    const audioPreloadCache = new Map();
    const audioPreloadOrder = [];
    function delay(ms){ return new Promise((resolve) => setTimeout(resolve, ms)); }
    function canValidateAudioSrc(src){
      if (typeof src !== 'string') return false;
      const trimmed = src.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith('/')) return true;
      if (/^https?:\/\//i.test(trimmed)) return true;
      if (/^[^:?#]+\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(trimmed)) return true;
      return false;
        }

    function resolvePlayableSrc(rawSrc){
      const src = typeof rawSrc === 'string' ? rawSrc.trim() : '';
      if (!src) return '';
      if (src.startsWith('/api/container?')) return src;
      if (/^https?:\/\//i.test(src)) return `/api/container?u=${encodeURIComponent(src)}`;
      return src;
        }

    function isFresh(entry){
      if (!entry || typeof entry.ts !== 'number') return false;
      return (Date.now() - entry.ts) < AUDIO_PROBE_TTL;
        }

    async function acquireProbeSlot(){
      if (activeAudioProbes >= MAX_CONCURRENT_AUDIO_PROBES) {
        await new Promise((resolve) => audioProbeWaiters.push(resolve));
      }
      activeAudioProbes += 1;
    }

    function releaseProbeSlot(){
      activeAudioProbes = Math.max(0, activeAudioProbes - 1);
      const next = audioProbeWaiters.shift();
      if (next) next();
    }

    function releasePreloadedSrc(src){
      if (!src) return;
      const audio = audioPreloadCache.get(src);
      if (audio) {
        try {
          audio.src = '';
          audio.load();
        } catch {}
        audioPreloadCache.delete(src);
      }
      const idx = audioPreloadOrder.indexOf(src);
      if (idx !== -1) audioPreloadOrder.splice(idx, 1);
    }

    function preloadAudioSrc(src){
      if (!src || audioPreloadCache.has(src)) return;
      try {
        const audio = new Audio();
        audio.preload = 'auto';
        audio.src = src;
        try { audio.load(); } catch {}
        audioPreloadCache.set(src, audio);
        audioPreloadOrder.push(src);
      } catch {}
      while (audioPreloadOrder.length > AUDIO_PRELOAD_LIMIT) {
        const stale = audioPreloadOrder.shift();
        releasePreloadedSrc(stale);
      }
    }

    function updatePlaylistTrackEntry(meta, update){
      if (!meta || !meta.playlistId || !meta.playlistTrackId) return;
      const playlist = playlists.find((p) => p && p.id === meta.playlistId);
      if (!playlist || !Array.isArray(playlist.tracks)) return;
      const entry = playlist.tracks.find((t) => t && t.id === meta.playlistTrackId);
      if (!entry) return;
      if (update.resolvedSrc) {
        entry.resolvedSrc = update.resolvedSrc;
      }
      if (update.rawUrl) {
        entry.mp3 = update.rawUrl;
      }
      if (update.audioField) entry.audioField = update.audioField;
    }

        async function refreshTrackContainerSource(row, options = {}){
      const meta = row?._meta || {};
      const recordId = options.recordId || meta.trackRecordId || meta.recordId || '';
      if (!recordId) return null;

      const requestedField = options.audioField || meta.audioField || '';
      const cacheKey = `${recordId}::${requestedField || 'default'}`;
      const now = Date.now();
      const CACHE_TTL = 30 * 60 * 1000;
      const useCache = !options.forceRefresh;
      const cached = useCache ? containerCache.get(cacheKey) : null;
      if (cached && (now - cached.ts) < CACHE_TTL) {
        if (cached.notFound) return { notFound: true };
        if (row) {
          row._src = cached.resolvedSrc;
          if (row._meta) {
            row._meta.src = cached.resolvedSrc;
            if (cached.audioField) row._meta.audioField = cached.audioField;
            updatePlaylistTrackEntry(row._meta, { rawUrl: cached.rawUrl, resolvedSrc: cached.resolvedSrc, audioField: cached.audioField });
          }
          row._lastContainerRefresh = now;
        }
        return { ...cached };
      }

      if (options.forceRefresh) {
        containerCache.delete(cacheKey);
      }

      const params = new URLSearchParams();
      if (requestedField) {
        params.set('field', requestedField);
      } else if (Array.isArray(options.candidates) && options.candidates.length) {
        params.set('candidates', options.candidates.join(','));
      }

      try {
        const query = params.toString();
        const endpoint = query
          ? `/api/track/${encodeURIComponent(recordId)}/container?${query}`
          : `/api/track/${encodeURIComponent(recordId)}/container`;
        const res = await fetch(endpoint, { headers: { 'Accept': 'application/json' } });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.url) {
          return null;
        }
        const rawUrl = json.url;
        const field = json?.field || requestedField || '';
        const resolvedSrc = resolvePlayableSrc(rawUrl);

        if (row) {
          row._src = resolvedSrc;
          if (row._meta) {
            row._meta.src = resolvedSrc;
            if (field) row._meta.audioField = field;
            updatePlaylistTrackEntry(row._meta, { rawUrl, resolvedSrc, audioField: field });
          }
          row._lastContainerRefresh = now;
        }

        containerCache.set(cacheKey, { rawUrl, resolvedSrc, audioField: field, ts: now });
        return { src: resolvedSrc, rawUrl, audioField: field };
      } catch (err) {
        console.warn('[MASS] Failed to refresh container source', err);
        return null;
      }
    }

    function findNextPlayableRow(row){
      if (!row) return null;
      let pointer = row.nextElementSibling;
      while (pointer) {
        if (pointer._src) return pointer;
        pointer = pointer.nextElementSibling;
      }
      return null;
    }

    function scheduleNextTrackPreload(row){
      const nextRow = findNextPlayableRow(row);
      if (!nextRow || !nextRow._src || audioPreloadCache.has(nextRow._src)) return;
      preloadAudioSrc(nextRow._src);
    }

    async function probeAudioSource(src, attempt = 0){
      const key = String(src || '').trim();
      if (!key) {
        const outcome = { ok: false, reason: 'Invalid link', ts: Date.now() };
        return outcome;
      }
      const cached = audioProbeCache.get(key);
      if (cached && isFresh(cached)) return cached;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), AUDIO_VALIDATE_TIMEOUT);
      let response;
      let outcome;
      await acquireProbeSlot();
      try {
        response = await fetch(src, {
          method: 'GET',
          headers: { Range: 'bytes=0-4095' },
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'include'
        });
      } catch (err) {
        outcome = { ok: false, reason: err?.name === 'AbortError' ? 'Timeout' : 'Unavailable', ts: Date.now() };
        if (outcome.reason === 'Timeout' && attempt < AUDIO_VALIDATE_MAX_RETRIES) {
          await delay(600 * (attempt + 1));
          releaseProbeSlot();
          clearTimeout(timeoutId);
          return probeAudioSource(src, attempt + 1);
        }
        audioProbeCache.set(key, outcome);
        return outcome;
      } finally {
        clearTimeout(timeoutId);
        releaseProbeSlot();
      }
      let buffer;
      try {
        if (!response || !response.ok) {
          if (response && response.status === 401) {
            console.warn('[MASS] Audio probe received 401', src);
          }
          outcome = { ok: false, reason: `HTTP ${response ? response.status : 'error'}`, ts: Date.now() };
        } else {
          const type = (response.headers.get('content-type') || '').toLowerCase();
          const len = response.headers.get('content-length');
          if (len === '0') {
            outcome = { ok: false, reason: 'Empty audio', ts: Date.now() };
          } else if (type && !/(audio|mpeg|mp3|ogg|wav|flac)/i.test(type)) {
            outcome = { ok: false, reason: 'Unexpected content', ts: Date.now() };
          } else {
            buffer = await response.arrayBuffer();
            if (!buffer || buffer.byteLength === 0) {
              outcome = { ok: false, reason: 'Empty audio', ts: Date.now() };
            } else {
              const bytes = new Uint8Array(buffer);
              if (!looksLikeAudio(bytes, type)) {
                outcome = { ok: false, reason: 'Unexpected content', ts: Date.now() };
              } else {
                outcome = { ok: true, ts: Date.now(), type, length: len ? Number(len) : undefined };
              }
            }
          }
        }
      } catch (err) {
        outcome = { ok: false, reason: 'Unavailable', ts: Date.now() };
      } finally {
        if (response && response.body && typeof response.body.cancel === 'function') {
          try { response.body.cancel(); } catch (_) {}
        }
      }

      if (!outcome.ok && outcome.reason === 'Timeout' && attempt < AUDIO_VALIDATE_MAX_RETRIES) {
        await delay(600 * (attempt + 1));
        return probeAudioSource(src, attempt + 1);
      }
      audioProbeCache.set(key, outcome);
      return outcome;
        }

    function looksLikeAudio(bytes, type){
      if (!bytes || !bytes.length) return false;
      const first = bytes[0];
      const second = bytes.length > 1 ? bytes[1] : 0;
      const third = bytes.length > 2 ? bytes[2] : 0;
      const fourth = bytes.length > 3 ? bytes[3] : 0;
      const head = String.fromCharCode(first, second, third, fourth);
      const nextHead = bytes.length >= 8 ? String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) : '';

      const startsWith = (prefix) => head.startsWith(prefix);

      if (startsWith('ID3')) return true;
      if (startsWith('OggS')) return true;
      if (startsWith('fLaC')) return true;
      if (startsWith('RIFF')) return true;
      if (startsWith('FORM')) return true; // AIFF/AIFF-C
      if (head.startsWith('ftyp') || nextHead === 'ftyp') return true; // MP4/M4A

      if (first === 0xFF && (second & 0xE0) === 0xE0) return true; // MPEG frame sync
      if (first === 0xAD && second === 0xAF) return true; // ADPCM

      // Common non-audio signatures
      if (first === 0x3C /* < */ || first === 0x7B /* { */ || first === 0x5B /* [ */) return false;
      if (head.toLowerCase().startsWith('http')) return false;

      if (type && /(audio|mpeg|mp3|ogg|wav|flac|aac)/i.test(type)) return true;

      return false;
        }

    function updateAlbumCardState(album){
      if (!album) return;
      const card = album._card;
      if (!card || !card.isConnected) return;

      const hasPlayable = !!album.hasPlayable;
      const pending = !!album._pendingValidation;

      card.dataset.pendingTracks = pending ? '1' : '0';
      card.dataset.validTracks = hasPlayable ? '1' : '0';

      card.classList.toggle('pending-audio', pending);

      if (hasPlayable) {
        card.dataset.hasAudioCandidates = 'true';
        card.classList.remove('no-audio');
        if (card.title === 'No playable audio available') card.removeAttribute('title');
      } else if (!pending) {
        card.dataset.hasAudioCandidates = 'false';
        card.classList.add('no-audio');
        if (!card.title) card.title = 'No playable audio available';
      }

      syncCardAudioState(card);
        }

    function ensureAlbumAudioValidation(album){
      if (!album) return;
      const key = album.key || makeAlbumKey(album.catalogue, album.title, album.artist);
      album.key = key;
      const existing = albumAudioState.get(key);
      if (existing) {
        if (existing.status === 'pending') return;
        if ((existing.status === 'valid' || existing.status === 'invalid') && isFresh(existing)) return;
      }

      const validator = runAlbumAudioValidation(album);
      album._pendingValidation = true;
      albumAudioState.set(key, { status: 'pending', promise: validator });
      validator
        .then((ok) => {
          albumAudioState.set(key, { status: ok ? 'valid' : 'invalid', ts: Date.now() });
          album._pendingValidation = false;
          album.hasPlayable = !!ok;
          updateAlbumCardState(album);
        })
        .catch((err) => {
          console.warn('[MASS] Album audio validation failed', err);
          albumAudioState.set(key, { status: 'invalid', ts: Date.now(), error: err });
          album._pendingValidation = false;
          album.hasPlayable = false;
          updateAlbumCardState(album);
        });
        }

    function primeAlbumAudioValidation(albums, limit = MAX_ALBUMS_TO_PRIME){
      if (!Array.isArray(albums) || !albums.length || limit <= 0) return;
      let processed = 0;
      for (const album of albums) {
        if (!album) continue;
        const key = album.key || makeAlbumKey(album.catalogue, album.title, album.artist);
        album.key = key;
        ensureAlbumAudioValidation(album);
        processed += 1;
        if (processed >= limit) break;
      }
        }

    async function runAlbumAudioValidation(album){
      const tracks = Array.isArray(album.tracks) ? album.tracks : [];
      if (!tracks.length) return false;
      const sources = [];
      const seen = new Set();
      for (const track of tracks) {
        const src = resolvePlayableSrc(track && track.mp3);
        if (!canValidateAudioSrc(src)) return false;
        if (seen.has(src)) continue;
        seen.add(src);
        sources.push(src);
        if (sources.length >= MAX_AUDIO_PROBES_PER_ALBUM) break;
      }
      if (!sources.length) return false;
      const results = await Promise.all(sources.map((src) => probeAudioSource(src)));
      return results.some((outcome) => outcome && outcome.ok);
        }

    async function validateAudio(row, src, options = {}){
      const btn = row && row._btn;
      const card = row && row._card;
      if (!btn) return;
      const token = Symbol('audio-validate');
      row._validationToken = token;
      const { optimistic = false } = options;

      const applyIfCurrent = (fn) => {
        if (row._validationToken !== token) return false;
        fn();
        return true;
      };

      const finalizeCard = (isValid) => {
        if (!card) return;
        let pending = Number(card.dataset.pendingTracks || '0');
        if (pending > 0) pending -= 1;
        card.dataset.pendingTracks = String(pending);
        if (isValid) {
          const valid = Number(card.dataset.validTracks || '0') + 1;
          card.dataset.validTracks = String(valid);
        }
        syncCardAudioState(card);
      };

      const setInvalid = (label) => {
        const applied = applyIfCurrent(() => {
          if (optimistic && currentRow === row && currentSrc === src) {
            player.pause();
            updateButtonsForStop();
          }
          btn.disabled = true;
          btn.textContent = label || 'Unavailable';
          btn.classList.add('btn-error');
          btn.classList.remove('btn-accent');
          btn.title = label || 'Audio unavailable';
          row._valid = false;
          row._validated = true;
          releasePreloadedSrc(src);
        });
        if (applied) finalizeCard(false);
      };

      const setValid = () => {
        const applied = applyIfCurrent(() => {
          if (!(currentRow === row && !player.paused)) {
            const playLabel = btn.dataset?.playLabel || '▶ Play';
            btn.textContent = playLabel;
            if (btn.dataset?.playAria) btn.setAttribute('aria-label', btn.dataset.playAria);
          }
          btn.disabled = false;
          btn.classList.remove('btn-error');
          btn.removeAttribute('title');
          row._valid = true;
          row._validated = true;
        });
        if (applied) finalizeCard(true);
      };

      if (!canValidateAudioSrc(src)) {
        if (card) card.dataset.hasAudioCandidates = 'true';
        setInvalid('Invalid link');
        return;
      }

      if (card) card.dataset.hasAudioCandidates = 'true';

      const key = typeof src === 'string' ? src.trim() : '';
      const cachedOutcome = key ? audioProbeCache.get(key) : null;
      if (cachedOutcome && isFresh(cachedOutcome) && cachedOutcome.reason !== 'Timeout') {
        if (cachedOutcome.ok) {
          setValid();
        } else {
          setInvalid(cachedOutcome.reason || 'Unavailable');
        }
        return;
      }

      const applied = applyIfCurrent(() => {
        if (!optimistic) {
          btn.disabled = true;
          btn.textContent = 'Checking…';
          btn.title = 'Validating audio…';
        }
        btn.classList.remove('btn-error');
        row._validating = true;
        if (card) {
          const pending = Number(card.dataset.pendingTracks || '0') + 1;
          card.dataset.pendingTracks = String(pending);
          syncCardAudioState(card);
        }
      });
      if (!applied) return;

      let currentSrcKey = key;
      let outcome = await probeAudioSource(src);

      if (!outcome.ok && /401/.test(String(outcome.reason || '')) && row) {
        const refreshed = await refreshTrackContainerSource(row, {
          recordId: row._meta?.trackRecordId || row._meta?.recordId,
          audioField: row._meta?.audioField || row._audioField || '',
          candidates: AUDIO_FIELD_CANDIDATES,
          forceRefresh: true
        });
        if (refreshed?.notFound) {
          row._src = '';
          setInvalid('Unavailable');
          row._validating = false;
          return;
        }
        if (refreshed && refreshed.src) {
          const newSrc = refreshed.src;
          currentSrcKey = String(newSrc || '').trim();
          audioProbeCache.delete(key);
          key = currentSrcKey;
          src = newSrc;
          outcome = await probeAudioSource(newSrc);
        }
      }

      if (outcome.ok) {
        setValid();
        if (optimistic && currentRow === row && player.paused && row._src) {
          queueTask(() => {
            if (row._btn) handlePlay(row._btn, row, row._src);
          });
        }
      } else {
        setInvalid(outcome.reason || 'Unavailable');
      }
      row._validating = false;
        }

    function syncCardAudioState(card){
      if (!card) return;
      const hasCandidates = card.dataset.hasAudioCandidates === 'true';
      const valid = Number(card.dataset.validTracks || '0');
      const pending = Number(card.dataset.pendingTracks || '0');
      if (valid > 0) {
        card.classList.remove('no-audio');
        if (card.title === 'No playable audio available') card.removeAttribute('title');
      } else if (!hasCandidates || pending === 0) {
        card.classList.add('no-audio');
        if (!card.title) card.title = 'No playable audio available';
      }
        }

    function abortInFlight(){ if(inFlight){ inFlight.abort(); inFlight=null; } }

    function snapshotState(overrides = {}){
      return {
        groups: albumGroups.slice(),
        page: albumPage,
        rawItems: rawItems.slice(),
        rawTotalFound,
        rawNextOffset,
        lastQ,
        searchValue: searchEl ? searchEl.value : '',
        mode: currentMode,
        ...overrides
      };
        }

    function applySnapshot(snapshot){
      if (!snapshot) return;
      albumGroups = Array.isArray(snapshot.groups) ? snapshot.groups.slice() : [];
      rawItems = Array.isArray(snapshot.rawItems) ? snapshot.rawItems.slice() : [];
      rawTotalFound = typeof snapshot.rawTotalFound === 'number' ? snapshot.rawTotalFound : rawItems.length;
      rawNextOffset = typeof snapshot.rawNextOffset === 'number' ? snapshot.rawNextOffset : rawItems.length;
      albumPage = typeof snapshot.page === 'number' ? snapshot.page : 0;
      lastQ = typeof snapshot.lastQ === 'string' ? snapshot.lastQ : '';
      currentMode = snapshot.mode || 'search';
      activePublicPlaylist = null;
      primeAlbumAudioValidation(albumGroups);
      refreshPublicPlaylists();
      if (searchEl && typeof snapshot.searchValue === 'string') {
        searchEl.value = snapshot.searchValue;
      }
      hideLanding();
      errorEl.hidden = true;
        }

    function restorePreviousSearch(){
      if (!prevSearch) return;
      const restore = prevSearch;
      prevSearch = null;

      const source = restore.snapshot || restore.paging || restore.original;
      if (source) {
        const snapshot = { ...source };
        if (restore.type === 'search' && typeof restore.term === 'string') {
          snapshot.lastQ = restore.term;
          snapshot.searchValue = restore.term;
        }
        isRestoring = true;
        applySnapshot(snapshot);
        renderAlbumPage();

        const needsRefetch = albumGroups.length <= 1 && ((restore.type === 'search' && typeof restore.term === 'string' && restore.term.trim()) || (restore.type === 'explore' && restore.start));
        if (needsRefetch) {
          if (restore.type === 'search') {
            if (searchEl) searchEl.value = restore.term;
            run(restore.term);
            return;
          } else if (restore.type === 'explore') {
            const startYear = Number(restore.start) || 0;
            if (startYear) {
              runExplore(startYear);
              return;
            }
          }
          isRestoring = false;
          return;
        }

        isRestoring = false;
        return;
      }

      if (restore.type === 'explore' && restore.start) {
        const startYear = Number(restore.start) || 0;
        if (startYear) {
          isRestoring = true;
          runExplore(startYear);
          return;
        }
      }

      if (restore.type === 'search' && typeof restore.term === 'string' && restore.term.trim()) {
        if (searchEl) searchEl.value = restore.term;
        isRestoring = true;
        run(restore.term);
        return;
      }
        }

    // Show placeholder graphic from /img/* until user searches
    function showLanding(){
      // Leaving explore/search: remove explore layout class
      try {
        const contentCol = document.querySelector('.content-column');
        contentCol && contentCol.classList.remove('exploring');
      } catch {}

      // Restore playlists when leaving search (landing)
      try {
        if (playlistColumn) playlistColumn.hidden = !Boolean(currentUser);
        if (publicFeaturedRow) publicFeaturedRow.removeAttribute('hidden');
      } catch {}

      if (sharedPlaylistActive) { clearSharedPlaylistState(); }
      currentMode = 'landing';
      currentExploreDecade = null;
      prevSearch = null;
      rawItems = [];
      albumsEl.classList.remove('single-album');
      pagerEl.hidden = true;
      if (shuffleBtn) shuffleBtn.hidden = true;
      countEl.textContent = '';
      errorEl.hidden = true;
      // Placeholder graphic removed; nothing else to show here.
    }

    async function loadRandomSongs() {
      console.log('[loadRandomSongs] Starting...');
      const perfStart = performance.now();
      // Show loading indicator
      if (loadingIndicator) loadingIndicator.hidden = false;
      if (albumsEl) albumsEl.style.display = 'none';

      try {
        const fetchStart = performance.now();
        console.log('[loadRandomSongs] Fetching from /api/random-songs?count=12');
        const r = await fetch('/api/random-songs?count=12');
        const fetchTime = performance.now() - fetchStart;
        if (!r.ok) {
          return;
        }

        const parseStart = performance.now();
        const j = await r.json();
        const parseTime = performance.now() - parseStart;

        if (!j || !Array.isArray(j.items) || j.items.length === 0) {
          return;
        }

        const totalTime = performance.now() - perfStart;
        console.log(`[loadRandomSongs] Loaded ${j.items.length} songs in ${totalTime.toFixed(0)}ms (fetch: ${fetchTime.toFixed(0)}ms)`);

        // Set mode
        currentMode = 'songs';
        activePublicPlaylist = null;

        // Hide public playlists row
        try {
          if (publicFeaturedRow) publicFeaturedRow.setAttribute('hidden', '');
        } catch {}

        // Render songs
        renderSongsGrid(j.items);
        updateAuthUI();

        // Show playlists column
        try {
          if (playlistColumn) playlistColumn.hidden = !Boolean(currentUser);
        } catch {}

      } catch (err) {
        console.warn('[loadRandomSongs]', err);
      } finally {
        // Always hide loading indicator
        if (loadingIndicator) loadingIndicator.hidden = true;
      }
    }

    function renderSongsGrid(songs) {
      console.log('[renderSongsGrid] Called with', songs.length, 'songs');
      if (loadingIndicator) loadingIndicator.hidden = true;
      if (albumsEl) albumsEl.style.display = '';

      albumsEl.innerHTML = '';
      countEl.textContent = `${songs.length} Random Songs`;
      pagerEl.hidden = true;
      if (shuffleBtn) shuffleBtn.hidden = false;

      for (const song of songs) {
        try {
          const fields = song.fields || {};
          const card = document.createElement('article');
          card.className = 'card';

          // Extract fields
          const trackTitle = pickFieldValue(fields, TRACK_TITLE_CANDIDATES).value || fields['Track Name'] || 'Unknown Track';
          const artist = pickFieldValue(fields, ['Album Artist', 'Artist', 'Tape Files::Album Artist']).value || 'Unknown Artist';
          const picture = pickFieldValue(fields, ARTWORK_FIELD_CANDIDATES).value;
          const audioField = pickFieldValue(fields, AUDIO_FIELD_CANDIDATES);
          const albumTitle = pickFieldValue(fields, ['Album', 'Tape Files::Album']).value || '';
          const catalogue = pickFieldValue(fields, ['Catalogue #', 'Catalogue']).value || '';

          console.log('[renderSongsGrid] Track:', trackTitle, 'Artist:', artist, 'Audio:', !!audioField.value, 'Picture:', !!picture);

          // Build metadata for stream event tracking
          const playableSrc = resolvePlayableSrc(audioField.value);
          card._src = playableSrc;
          card._meta = {
            trackName: trackTitle,
            trackArtist: artist,
            albumTitle: albumTitle,
            albumArtist: artist,
            playlistId: null,
            playlistName: '',
            picture: picture || '',
            source: 'random',
            catalogue: catalogue,
            audioField: audioField.field || '',
            trackRecordId: song.recordId || '',
            pictureField: pickFieldValue(fields, ARTWORK_FIELD_CANDIDATES).field || '',
            src: playableSrc
          };

          // Album artwork (use actual artwork or placeholder fallback)
          const wrap = document.createElement('div');
          wrap.className = 'cover-wrap';
          const img = document.createElement('img');
          if (picture) {
            img.src = `/api/container?u=${encodeURIComponent(picture)}`;
            img.onerror = () => { img.src = '/img/placeholder.png'; }; // Fallback on error
          } else {
            img.src = '/img/placeholder.png'; // No artwork - use placeholder
          }
          img.alt = 'Cover';
          img.loading = 'lazy';
          wrap.appendChild(img);
          card.appendChild(wrap);

          // Track title and artist
          const heading = document.createElement('div');
          heading.className = 'heading';
          const h3 = document.createElement('h3');
          h3.textContent = trackTitle;
          heading.appendChild(h3);

          const artistDiv = document.createElement('div');
          artistDiv.style.color = 'var(--muted)';
          artistDiv.style.fontSize = '13px';
          artistDiv.style.marginTop = '4px';
          artistDiv.textContent = artist;
          heading.appendChild(artistDiv);

          card.appendChild(heading);

          // Play button
          if (audioField.value && playableSrc) {
            const playBtn = document.createElement('button');
            playBtn.className = 'play-button';
            playBtn.textContent = '▶ Play';
            playBtn.dataset.loadingLabel = 'Loading…';
            playBtn.addEventListener('click', () => {
              handlePlay(playBtn, card, playableSrc);
            });
            card.appendChild(playBtn);
          }

          // Add to playlist button
          const addBtn = document.createElement('button');
          addBtn.className = 'btn secondary small';
          addBtn.textContent = '+ Playlist';
          addBtn.style.marginTop = '8px';
          addBtn.addEventListener('click', () => {
            // Build album and track objects for handleAddToPlaylist
            const albumData = {
              title: pickFieldValue(fields, ['Album', 'Tape Files::Album']).value || '',
              artist: artist,
              catalogue: pickFieldValue(fields, ['Catalogue #', 'Catalogue']).value || '',
              picture: picture,
              pictureField: pickFieldValue(fields, ARTWORK_FIELD_CANDIDATES).field || ''
            };

            const trackData = {
              recordId: song.recordId || '',
              name: trackTitle,
              trackArtist: pickFieldValue(fields, ['Artist', 'Track Artist']).value || artist,
              seq: pickFieldValue(fields, ['Track #', 'Track Number', 'Seq']).value || null,
              mp3: audioField.value,
              mp3Field: audioField.field || '',
              audioField: audioField.field || ''
            };

            const playableSrc = resolvePlayableSrc(audioField.value);
            handleAddToPlaylist(albumData, trackData, playableSrc);
          });
          card.appendChild(addBtn);

          albumsEl.appendChild(card);
          console.log('[renderSongsGrid] Card added for', trackTitle);
        } catch (err) {
          console.error('[renderSongsGrid] Error rendering song:', err);
        }
      }
      console.log('[renderSongsGrid] Finished rendering', albumsEl.children.length, 'cards');
    }

    async function loadRandomAlbums() {
      const perfStart = performance.now();
      // Show loading indicator
      if (loadingIndicator) loadingIndicator.hidden = false;
      if (albumsEl) albumsEl.style.display = 'none';

      try {
        // Pick a random decade from 1950s to 2020s
        const decades = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
        const randomDecade = decades[Math.floor(Math.random() * decades.length)];
        const start = randomDecade;
        const end = start + 9;

        const params = new URLSearchParams();
        params.set('start', String(start));
        params.set('end', String(end));
        params.set('limit', '150'); // Balanced: enough albums without timing out

        const fetchStart = performance.now();
        const r = await fetch(`/api/explore?${params}`);
        const fetchTime = performance.now() - fetchStart;
        if (!r.ok) {
          return;
        }

        const parseStart = performance.now();
        const j = await r.json();
        const parseTime = performance.now() - parseStart;

        if (!j || !Array.isArray(j.items) || j.items.length === 0) {
          return;
        }

        rawItems = j.items || [];
        rawTotalFound = Number(j.total || rawItems.length);

        const groupStart = performance.now();
        const groupedAlbums = groupAlbums(rawItems);
        const groupTime = performance.now() - groupStart;

        if (!groupedAlbums.length) {
          return;
        }

        // Shuffle and keep all albums for pagination
        const shuffleStart = performance.now();
        shuffleInPlace(groupedAlbums);
        const shuffleTime = performance.now() - shuffleStart;

        albumGroups = groupedAlbums;
        rawItems = albumGroups;
        rawTotalFound = albumGroups.length;
        rawNextOffset = albumGroups.length;

        const totalTime = performance.now() - perfStart;
        console.log(`[loadRandomAlbums] Loaded ${albumGroups.length} albums from ${j.items.length} tracks in ${totalTime.toFixed(0)}ms (fetch: ${fetchTime.toFixed(0)}ms)`);

        albumPage = 0;
        currentMode = 'explore';
        currentExploreDecade = null; // Random load, no specific decade
        activePublicPlaylist = null;

        // Set up explore layout
        try {
          const contentCol = document.querySelector('.content-column');
          if (contentCol) contentCol.classList.add('exploring');
        } catch {}

        // Skip expensive audio validation on initial load
        // primeAlbumAudioValidation(albumGroups);
        refreshPublicPlaylists();
        renderAlbumPage();
        updateAuthUI(); // Show featured playlists panel

        // Show playlists
        try {
          if (playlistColumn) playlistColumn.hidden = !Boolean(currentUser);
          if (publicFeaturedRow) publicFeaturedRow.removeAttribute('hidden');
        } catch {}

      } catch (err) {
        console.warn('[loadRandomAlbums]', err);
      } finally {
        // Always hide loading indicator
        if (loadingIndicator) loadingIndicator.hidden = true;
        if (albumsEl) albumsEl.style.display = '';
      }
    }
function hideLanding(){ /* no-op: placeholder removed */ }function doSearch(q){
      abortInFlight();
      const ctrl = new AbortController();
      inFlight = ctrl;
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      params.set('offset', 0);
      params.set('limit',  FM_FETCH_LIMIT);
      return fetch(`/api/search?${params}`, { signal: ctrl.signal })
        .then(async r => {
          if (!r.ok) throw new Error(await r.text().catch(() => `HTTP ${r.status}`));
          return r.json();
        })
        .finally(() => { if (inFlight === ctrl) inFlight = null; });
        }


    // Strong normalization to reduce bogus “same album different title”
    function normTitle(s){
      return String(s||'')
        .replace(/\s+/g,' ')
        .replace(/[\u2018\u2019]/g,"'")
        .replace(/[\u201C\u201D]/g,'"')
        .replace(/^\W+|\W+$/g,'') // trim leading/trailing punctuation
        .trim();
        }
    function keyTitle(s){ return normTitle(s).toLowerCase(); }

    function makeAlbumKey(catalogue, title, artist){
      const cat = String(catalogue || '').trim();
      if (cat) return `cat:${cat.toLowerCase()}`;
      const normT = normTitle(title || '').toLowerCase();
      const normA = normTitle(artist || '').toLowerCase();
      return `title:${normT}|artist:${normA}`;
        }

    function groupAlbums(items){
      const byCat = new Map();

      for (const rec of items) {
        const f = rec.fields || {};
        const cat = fCatalogue(f) || '__NO_CAT__';
        const title = normTitle(fTitle(f) || '(no album)');
        const artist= normTitle(fArtist(f) || '');
        const trackArtist = normTitle(f['Track Artist'] || f['Tape Files::Track Artist'] || '');
        const pictureInfo = pickFieldValue(f, ARTWORK_FIELD_CANDIDATES);
        const pic   = String(pictureInfo.value || '').trim();
        const pictureField = pictureInfo.field || '';
        const track = normTitle(f[F_TRACK] || '');
        const mp3Info = pickFieldValue(f, AUDIO_FIELD_CANDIDATES);
        const mp3   = mp3Info.value || '';
        const mp3Field = mp3Info.field || '';
        const publicPlaylistInfo = pickFieldValue(f, PUBLIC_PLAYLIST_FIELD_CANDIDATES);
        const publicPlaylistRaw = publicPlaylistInfo.value || '';
        const playlistNames = publicPlaylistRaw
          ? publicPlaylistRaw.split(/[,;|\n\r]/).map((value) => value.trim()).filter(Boolean)
          : [];
        const genre = normTitle(f[F_GENRE] || '');
        const comps = composersFrom(f).map(value => normTitle(value || ''));
        const prod  = normTitle(f['Producer'] || '');
        const lang  = normTitle(fLang(f) || '');
        const composer1 = normTitle(f['Composer'] || f['Composer 1'] || f['Composer1'] || '');
        const composer2 = normTitle(f['Composer 2'] || f['Composer2'] || '');
        const composer3 = normTitle(f['Composer 3'] || f['Composer3'] || '');
        const composer4 = normTitle(f['Composer 4'] || f['Composer4'] || '');
        const isrc = (f['ISRC'] || '').trim();
        // Check Audio Test field for invalid/bad audio markers
        const audioTest = String(f['songfiles:Audio Test'] || f['Songfiles::Audio Test'] || f['songfiles::Audio Test'] || f['Audio Test'] || '').toLowerCase();
        const hasValidAudio = audioTest ? !audioTest.includes('invalid') : true;

        if(!byCat.has(cat)){
          byCat.set(cat, {
            catalogue: cat === '__NO_CAT__' ? '' : cat,
            titles: new Map(), // keyTitle -> {raw,count}
            artist,
            picture: pic || '',
            pictureField: pictureField || '',
            tracks: []
          });
        }
        const g = byCat.get(cat);

        const kt = keyTitle(title);
        const entry = g.titles.get(kt) || { raw: title, count: 0 };
        entry.count += 1; g.titles.set(kt, entry);

        if(!g.picture && pic) {
          g.picture = pic;
          g.pictureField = pictureField;
        }
        if(!g.artist && artist) g.artist = artist;

        // keep all tracks for title logic; mp3 validity filtered later
        if(track){
          const orderIndex = g.tracks.length;
          g.tracks.push({
            name: track,
            mp3,
            mp3Field,
            genre,
            composers: comps,
            producer: prod,
            language: lang,
            trackArtist,
            pictureField,
            composer1,
            composer2,
            composer3,
            composer4,
            isrc,
            publicPlaylists: playlistNames,
            seq: parseTrackSequence(f),
            recordId: rec.recordId || '',
            _order: orderIndex,
            hasValidAudio
          });
        }
      }

      const groups = [];
      for(const g of byCat.values()){
        const trimmedPicture = (g.picture || '').trim();
        // Removed hard filter for missing pictures - let toggle control this
        // if (!trimmedPicture) continue;

        if (!g.tracks.length) continue;

        const playableTracks = g.tracks.filter(t => hasValidMp3(t.mp3) && t.hasValidAudio);
        // Removed hard filter for no playable tracks - let toggle control this
        // if (!playableTracks.length) continue;

        // Only show tracks with valid audio
        const tracksForDisplay = playableTracks.map(track => ({ ...track }));

        const albumPlaylistMap = new Map();
        for (const track of g.tracks) {
          if (!Array.isArray(track.publicPlaylists)) continue;
          for (const name of track.publicPlaylists) {
            const trimmed = String(name || '').trim();
            if (!trimmed) continue;
            const key = trimmed.toLowerCase();
            if (!albumPlaylistMap.has(key)) albumPlaylistMap.set(key, trimmed);
          }
        }
        const albumPublicPlaylists = Array.from(albumPlaylistMap.values());

        // Ignore title candidates that equal any track name (prevents “Sunday Afternoon” issue)
        const trackKeys = new Set(g.tracks.map(t => keyTitle(t.name)));
        const candidates = Array.from(g.titles.entries()); // [keyTitle, {raw,count}]
        const filtered = candidates.filter(([kt]) => !trackKeys.has(kt));

        const pickFrom = (arr) => arr.reduce((best, cur) => (!best || cur[1].count > best[1].count) ? cur : best, null);
        const pickedPair = pickFrom(filtered.length ? filtered : candidates);
        const displayTitle = pickedPair ? pickedPair[1].raw : '(no album)';

        // Sort playable tracks (replace with Track No if available)
        tracksForDisplay.sort((a, b) => {
          const aSeq = Number(a.seq);
          const bSeq = Number(b.seq);
          const aFinite = Number.isFinite(aSeq);
          const bFinite = Number.isFinite(bSeq);
          if (aFinite && bFinite && aSeq !== bSeq) return aSeq - bSeq;
          if (aFinite && !bFinite) return -1;
          if (!aFinite && bFinite) return 1;
          const aOrder = Number.isFinite(a._order) ? a._order : Number.POSITIVE_INFINITY;
          const bOrder = Number.isFinite(b._order) ? b._order : Number.POSITIVE_INFINITY;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

        const albumKey = makeAlbumKey(g.catalogue, displayTitle, g.artist);
        const hasPlayable = playableTracks.length > 0;
        groups.push({
          catalogue: g.catalogue,
          title: displayTitle,
          artist: g.artist,
          picture: trimmedPicture,
          pictureField: g.pictureField || '',
          tracks: tracksForDisplay,
          hasPlayable,
          publicPlaylists: albumPublicPlaylists,
          key: albumKey
        });
      }

      groups.sort((a,b)=> a.title.localeCompare(b.title, undefined, { sensitivity:'base' }) || a.artist.localeCompare(b.artist, undefined, { sensitivity:'base' }));
      return groups;
        }

    function computePublicPlaylistsFromAlbums(albums){
      const summaryMap = new Map();
      for (const album of albums || []) {
        if (!album) continue;
        const albumKey = album.key || '';
        const tracks = Array.isArray(album.tracks) ? album.tracks : [];
        const trackCount = tracks.length;
        const names = Array.isArray(album.publicPlaylists) ? album.publicPlaylists : [];
        if (!names.length) continue;
        for (const rawName of names) {
          const trimmed = String(rawName || '').trim();
          if (!trimmed) continue;
          const key = trimmed.toLowerCase();
          let entry = summaryMap.get(key);
          if (!entry) {
            entry = { name: trimmed, albumKeys: new Set(), albumCount: 0, trackCount: 0 };
            summaryMap.set(key, entry);
          }
          if (!entry.albumKeys.has(albumKey)) {
            entry.albumKeys.add(albumKey);
            entry.albumCount += 1;
            entry.trackCount += trackCount;
          }
        }
      }
      const summary = Array.from(summaryMap.values()).map(({ name, albumCount, trackCount, image }) => ({ name, albumCount, trackCount, image: image || '' }));
      summary.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      return summary;
        }

    function setActivePublicPlaylist(nextName, imageHint = ''){
      if (!publicPlaylistsLoaded && !publicPlaylistsLoading) {
        loadPublicPlaylistSummaries();
      }
      const name = typeof nextName === 'string' ? nextName.trim() : '';
      const currentKey = activePublicPlaylist ? activePublicPlaylist.toLowerCase() : '';
      const nextKey = name.toLowerCase();
      const summaryEntry = publicPlaylistsSummary.find((entry) => entry && typeof entry.name === 'string' && entry.name.toLowerCase() === nextKey) || null;
      const summaryImage = summaryEntry?.image || imageHint || '';

      if (!name || (currentKey && currentKey === nextKey && !publicPlaylistTracksLoading)) {
        activePublicPlaylist = null;
        activePublicPlaylistImage = '';
        activePublicPlaylistTracks = [];
        publicPlaylistTracksError = null;
        albumPage = 0;
        currentMode = 'songs';
        renderPublicPlaylists();
        renderPublicPlaylistView();
        // Reload random songs when deselecting
        loadRandomSongs();
        return;
      }

      activePublicPlaylist = name;
      activePublicPlaylistImage = summaryImage;
      currentMode = 'public-playlist';
      publicPlaylistTracksError = null;
      albumPage = 0;

      const cached = publicPlaylistTracksCache.get(nextKey);
      if (cached) {
        activePublicPlaylistTracks = Array.isArray(cached.tracks) ? cached.tracks.slice() : [];
        renderPublicPlaylists();
        renderPublicPlaylistView();
        renderAlbumPage();
        return;
      }

      activePublicPlaylistTracks = [];
      renderPublicPlaylists();
      renderPublicPlaylistView();
      renderAlbumPage();
      loadPublicPlaylistTracks(name);
        }

    function refreshPublicPlaylists(source = albumGroups){
      if (!publicPlaylistsLoaded && source) {
        publicPlaylistsSummary = computePublicPlaylistsFromAlbums(source || []);
      }
      if (activePublicPlaylist) {
        const activeKey = activePublicPlaylist.toLowerCase();
        const stillExists = publicPlaylistsSummary.some((entry) => entry.name.toLowerCase() === activeKey);
        if (!stillExists) activePublicPlaylist = null;
      }
      renderPublicPlaylists();
      renderPublicPlaylistView();
      updateAuthUI();
        }

    function renderPublicPlaylists(){
      if (publicPlaylistsEmpty) {
        if (publicPlaylistsLoading) {
          publicPlaylistsEmpty.textContent = 'Loading curated playlists…';
          publicPlaylistsEmpty.hidden = false;
        } else if (publicPlaylistsError) {
          publicPlaylistsEmpty.textContent = publicPlaylistsError;
          publicPlaylistsEmpty.hidden = false;
        } else {
          publicPlaylistsEmpty.textContent = 'No curated playlists yet.';
          publicPlaylistsEmpty.hidden = (publicPlaylistsSummary.length > 0);
        }
      }

      if (!publicPlaylistsList) return;
      publicPlaylistsList.innerHTML = '';
      const items = Array.isArray(publicPlaylistsSummary) ? publicPlaylistsSummary : [];
      const activeKey = activePublicPlaylist ? activePublicPlaylist.toLowerCase() : '';
      if (!items.length) {
        syncPublicFeaturedVisibility();
        return;
      }

      items.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'public-playlist-item';
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.playlistName = item.name || '';
        if (item.image) button.dataset.image = item.image;

        const thumb = document.createElement('span');
        thumb.className = 'public-playlist-thumb';
        const initialChar = (item.name || '').trim().charAt(0);
        thumb.textContent = initialChar || '♪';
        button.appendChild(thumb);

        const label = document.createElement('span');
        label.className = 'public-playlist-label';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'public-playlist-name';
        nameSpan.textContent = item.name || 'Playlist';
        label.appendChild(nameSpan);
        const countSpan = document.createElement('span');
        countSpan.className = 'public-playlist-count';
        const countParts = [];
        countParts.push(`${item.albumCount} album${item.albumCount === 1 ? '' : 's'}`);
        if (item.trackCount > 0) {
          countParts.push(`${item.trackCount} track${item.trackCount === 1 ? '' : 's'}`);
        }
        countSpan.textContent = countParts.join(' • ');
        label.appendChild(countSpan);
        button.appendChild(label);

        if (item.name && item.name.toLowerCase() === activeKey) {
          button.classList.add('active');
        }
        button.addEventListener('click', () => setActivePublicPlaylist(item.name, item.image || button.dataset.image || ''));
        applyPlaylistThumbArtwork(thumb, item.name, item.image || button.dataset.image || '');
        li.appendChild(button);
        publicPlaylistsList.appendChild(li);
      });

      syncPublicFeaturedVisibility();
        }

    async function loadPublicPlaylistSummaries(){
      if (publicPlaylistsLoaded || publicPlaylistsLoading) return;
      publicPlaylistsLoading = true;
      publicPlaylistsError = null;
      renderPublicPlaylists();
      updateAuthUI();
      try {
        const res = await fetch('/api/public-playlists', { headers: { 'Accept': 'application/json' } });
        if (!res.ok) {
          const text = await res.text().catch(() => `HTTP ${res.status}`);
          throw new Error(text || 'Unable to load curated playlists');
        }
        const data = await res.json().catch(() => ({}));
        if (Array.isArray(data?.playlists)) {
          publicPlaylistsSummary = data.playlists;
        } else {
          publicPlaylistsSummary = [];
        }
        publicPlaylistsLoaded = true;
        // Don't auto-select any playlist - let user click to view
      } catch (err) {
        publicPlaylistsError = err?.message || 'Unable to load curated playlists';
      } finally {
        publicPlaylistsLoading = false;
        renderPublicPlaylists();
        renderPublicPlaylistView();
        updateAuthUI();
      }
        }

    async function loadPublicPlaylistTracks(name){
      const key = name.toLowerCase();
      publicPlaylistTracksLoading = true;
      publicPlaylistTracksError = null;
      renderPublicPlaylistView();
      try {
        const res = await fetch(`/api/public-playlists?name=${encodeURIComponent(name)}`, {
          headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) {
          const text = await res.text().catch(() => `HTTP ${res.status}`);
          throw new Error(text || 'Unable to load playlist');
        }
        const data = await res.json().catch(() => ({}));
        if (Array.isArray(data?.playlists)) {
          publicPlaylistsSummary = data.playlists;
          publicPlaylistsLoaded = true;
        }
        const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
        const sortedTracks = tracks
          .slice()
          .sort((a, b) => {
            const aSeq = Number.isFinite(a?.seq) ? Number(a.seq) : Number.POSITIVE_INFINITY;
            const bSeq = Number.isFinite(b?.seq) ? Number(b.seq) : Number.POSITIVE_INFINITY;
            if (aSeq !== bSeq) return aSeq - bSeq;
            const aName = String(a?.name || '').toLowerCase();
            const bName = String(b?.name || '').toLowerCase();
            if (aName < bName) return -1;
            if (aName > bName) return 1;
            return 0;
          });
        publicPlaylistTracksCache.set(key, { tracks: sortedTracks.slice() });
        if (activePublicPlaylist && activePublicPlaylist.toLowerCase() === key) {
          activePublicPlaylistTracks = sortedTracks;
        }
      } catch (err) {
        publicPlaylistTracksError = err?.message || 'Unable to load playlist tracks';
        if (activePublicPlaylist && activePublicPlaylist.toLowerCase() === key) {
          activePublicPlaylistTracks = [];
        }
      } finally {
        publicPlaylistTracksLoading = false;
        renderPublicPlaylists();
        renderPublicPlaylistView();
        renderAlbumPage();
      }
        }

    function createPublicPlaylistRow(track, idx, playlistId, playlistName){
      const li = document.createElement('li');
      li.className = 'track playlist-track public-playlist-track';

      const btnPlay = document.createElement('button');
      btnPlay.type = 'button';
      btnPlay.className = 'btn track-play';

      const srcCandidate = track?.resolvedSrc || track?.mp3 || '';
      const playableCandidate = resolvePlayableSrc(srcCandidate || '');
      const playableSrc = canValidateAudioSrc(playableCandidate) ? playableCandidate : '';
      const audioField = typeof track?.audioField === 'string' ? track.audioField.trim() : '';
      const artworkField = typeof track?.artworkField === 'string' ? track.artworkField.trim() : '';
      const playlistImage = activePublicPlaylistImage || '';

      li._src = playableSrc;
      li._btn = btnPlay;
      li._card = null;
      li._playlist = playlistId;
      li._audioField = audioField;
      li._valid = null;
      li._validated = false;
      li._validating = false;

      const trackId = track?.trackRecordId || track?.id || '';
      if (trackId) li.dataset.trackId = trackId;

      btnPlay.dataset.playLabel = '▶';
      btnPlay.dataset.pauseLabel = '⏸';

      const trackName = track?.name || 'Untitled track';
      const artist = (track?.trackArtist || track?.albumArtist || '').trim();
      const readable = artist ? `${artist} — ${trackName}` : trackName;
      btnPlay.dataset.playAria = `Play ${readable}`;
      btnPlay.dataset.pauseAria = `Pause ${readable}`;

      if (playableSrc) {
        btnPlay.textContent = btnPlay.dataset.playLabel;
        btnPlay.disabled = false;
        btnPlay.classList.remove('btn-error');
        btnPlay.setAttribute('aria-label', btnPlay.dataset.playAria);
      } else {
        btnPlay.textContent = 'No audio';
        btnPlay.disabled = true;
        btnPlay.classList.add('btn-error');
        btnPlay.setAttribute('aria-label', `Audio unavailable for ${readable}`);
      }

      btnPlay.addEventListener('click', () => {
        if (!li._src) {
          window.alert('This track has no playable audio source.');
          return;
        }
        if (li._valid === false) {
          btnPlay.textContent = 'Unavailable';
          btnPlay.disabled = true;
          btnPlay.classList.add('btn-error');
          btnPlay.setAttribute('aria-label', `Audio unavailable for ${readable}`);
          return;
        }
        handlePlay(btnPlay, li, li._src);
        if (li._valid === true || li._validating) return;
        li._validating = true;
        validateAudio(li, li._src, { optimistic: true }).finally(() => {
          li._validating = false;
        });
      });

      const wrapper = document.createElement('span');
      wrapper.className = 'track-name';

      if (artist) {
        const artistLine = document.createElement('span');
        artistLine.className = 'track-name-artist';
        artistLine.textContent = artist;
        wrapper.appendChild(artistLine);

        const titleLine = document.createElement('span');
        titleLine.className = 'track-name-title';
        titleLine.textContent = trackName;
        wrapper.appendChild(titleLine);
      } else {
        const titleLine = document.createElement('span');
        titleLine.className = 'track-name-title';
        titleLine.textContent = trackName;
        wrapper.appendChild(titleLine);
      }

      const tooltipParts = [artist, track?.albumTitle, track?.albumArtist].filter((part) => typeof part === 'string' && part.trim());
      if (tooltipParts.length) {
        const tooltip = tooltipParts.join(' • ');
        wrapper.title = tooltip;
        li.title = tooltip;
      }

      li.appendChild(btnPlay);
      li.appendChild(wrapper);

      const baseMeta = {
        trackName,
        trackArtist: track?.trackArtist || track?.albumArtist || '',
        albumTitle: track?.albumTitle || '',
        albumArtist: track?.albumArtist || '',
        catalogue: track?.catalogue || '',
        playlistId,
        playlistName,
        playlistTrackId: trackId,
        trackRecordId: trackId,
        trackId,
        audioField,
        pictureField: artworkField || 'Artwork::Picture',
        picture: track?.picture || track?.albumPicture || playlistImage || '',
        albumPicture: track?.albumPicture || track?.picture || playlistImage || '',
        src: playableSrc,
        mp3: track?.mp3 || '',
        producer: track?.producer || '',
        language: track?.language || '',
        genre: track?.genre || '',
        isrc: track?.isrc || '',
        composer1: track?.composer1 || '',
        composer2: track?.composer2 || '',
        composer3: track?.composer3 || '',
        composer4: track?.composer4 || '',
        composers: Array.isArray(track?.composers) ? track.composers : [],
        albumKey: track?.albumKey || makeAlbumKey(track?.catalogue || '', track?.albumTitle || '', track?.albumArtist || ''),
        source: 'public-playlist'
      };
      li._meta = baseMeta;

      return { element: li, button: btnPlay, playableSrc };
        }

    function renderPublicPlaylistView(){
      if (!publicPlaylistView) return;
      const hasActive = Boolean(activePublicPlaylist);

      if (!hasActive) {
        publicPlaylistView.hidden = true;
        if (publicPlaylistStatus) {
          publicPlaylistStatus.hidden = true;
          publicPlaylistStatus.textContent = '';
        }
        resetPlaylistArtwork(publicPlaylistArt, publicPlaylistHero);
        if (publicPlaylistTracks) publicPlaylistTracks.innerHTML = '';
        if (publicPlaylistEmpty) publicPlaylistEmpty.hidden = true;
        if (albumsEl) albumsEl.style.display = '';
        syncPublicFeaturedVisibility();
        return;
      }

      hideLanding();
      publicPlaylistView.hidden = false;
      hideLanding();
      if (albumsEl) albumsEl.style.display = 'none';
      if (pagerEl) pagerEl.hidden = true;
      if (errorEl) errorEl.hidden = true;

      const summaryEntry = publicPlaylistsSummary.find((entry) => entry && typeof entry.name === 'string' && entry.name.toLowerCase() === activePublicPlaylist.toLowerCase());
      const heroImage = activePublicPlaylistImage || summaryEntry?.image || '';
      if (!activePublicPlaylistImage && heroImage) activePublicPlaylistImage = heroImage;
      loadPlaylistArtwork(publicPlaylistArt, publicPlaylistHero, activePublicPlaylist, {
        preferredUrls: heroImage ? [heroImage] : [],
        altText: activePublicPlaylist ? `${activePublicPlaylist} artwork` : 'Playlist artwork'
      });
      if (publicPlaylistTitle) publicPlaylistTitle.textContent = summaryEntry?.name || activePublicPlaylist || 'Featured Playlist';

      const trackCount = activePublicPlaylistTracks.length;
      if (publicPlaylistMeta) {
        publicPlaylistMeta.textContent = '';
        publicPlaylistMeta.hidden = true;
      }

      if (publicPlaylistStatus) {
        if (publicPlaylistTracksLoading) {
          publicPlaylistStatus.textContent = 'Loading tracks…';
          publicPlaylistStatus.hidden = false;
        } else if (publicPlaylistTracksError) {
          publicPlaylistStatus.textContent = publicPlaylistTracksError;
          publicPlaylistStatus.hidden = false;
        } else {
          publicPlaylistStatus.textContent = '';
          publicPlaylistStatus.hidden = true;
        }
      }

      if (publicPlaylistTracks) {
        const previousState = (currentRow && currentRow._playlist === `public:${activePublicPlaylist.toLowerCase()}`)
          ? {
              playlistId: currentRow._playlist,
              src: currentRow._src,
              playing: !player.paused && currentSrc === currentRow._src
            }
          : null;
        let matchedPlayback = false;

        publicPlaylistTracks.innerHTML = '';

        if (!publicPlaylistTracksLoading && !publicPlaylistTracksError && trackCount > 0) {
          const playlistId = `public:${activePublicPlaylist.toLowerCase()}`;
          activePublicPlaylistTracks.forEach((track, idx) => {
            const { element, button, playableSrc } = createPublicPlaylistRow(track, idx, playlistId, activePublicPlaylist);
            publicPlaylistTracks.appendChild(element);

            if (
              playableSrc &&
              previousState &&
              previousState.src === playableSrc &&
              previousState.playlistId === playlistId
            ) {
              matchedPlayback = true;
              currentRow = element;
              currentBtn = button;
              if (previousState.playing) {
                element.classList.add('playing');
                button.textContent = button.dataset.pauseLabel || '⏸';
                button.classList.add('btn-accent');
                button.disabled = false;
                if (button.dataset.pauseAria) button.setAttribute('aria-label', button.dataset.pauseAria);
              } else {
                button.textContent = button.dataset.playLabel || '▶';
                button.classList.remove('btn-accent');
                if (button.dataset.playAria) button.setAttribute('aria-label', button.dataset.playAria);
              }
              setNowPlayingFromRow(element, previousState.playing);
            }
          });

          requestAnimationFrame(() => {
            if (!publicPlaylistTracks) return;
            const items = Array.from(publicPlaylistTracks.children);
            const maxVisible = 5;
            if (items.length <= maxVisible) {
              publicPlaylistTracks.style.maxHeight = '';
              return;
            }
            const first = items[0];
            const last = items[maxVisible - 1];
            if (!first || !last) {
              publicPlaylistTracks.style.maxHeight = '';
              return;
            }
            const firstRect = first.getBoundingClientRect();
            const lastRect = last.getBoundingClientRect();
            const height = Math.max(0, lastRect.bottom - firstRect.top + 4);
            publicPlaylistTracks.style.maxHeight = `${height}px`;
          });

          if (!previousState && nowPlayingInfo.meta && nowPlayingInfo.meta.playlistId === `public:${activePublicPlaylist.toLowerCase()}`) {
            const targetSrc = nowPlayingInfo.meta.src || nowPlayingInfo.meta.playlistSrc || '';
            const candidate = Array.from(publicPlaylistTracks.children).find((child) => child._src && child._src === targetSrc);
            if (candidate && candidate._btn) {
              currentRow = candidate;
              currentBtn = candidate._btn;
              candidate.classList.toggle('playing', nowPlayingInfo.isPlaying);
            }
          }

          if (previousState && previousState.playlistId === `public:${activePublicPlaylist.toLowerCase()}` && !matchedPlayback) {
            if (previousState.playing && !player.paused && currentSrc === previousState.src) {
              player.pause();
            }
            currentSrc = '';
            updateButtonsForStop();
          }
        }
      }

      if (publicPlaylistTracks && (publicPlaylistTracksLoading || publicPlaylistTracksError || trackCount <= 5)) {
        publicPlaylistTracks.style.maxHeight = trackCount > 0 ? '' : '0px';
      }

      if (publicPlaylistEmpty) {
        const showEmpty = !publicPlaylistTracksLoading && !publicPlaylistTracksError && trackCount === 0;
        publicPlaylistEmpty.hidden = !showEmpty;
      }
      syncPublicFeaturedVisibility();
        }

    function collectSharedPlaylistArtwork(playlist){
      if (!playlist || typeof playlist !== 'object') return [];
      const seen = new Set();
      const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
      const results = [];
      for (const track of tracks) {
        if (!track || typeof track !== 'object') continue;
        const candidates = [
          typeof track.artwork === 'string' ? track.artwork.trim() : '',
          typeof track.picture === 'string' ? track.picture.trim() : '',
          typeof track.albumPicture === 'string' ? track.albumPicture.trim() : ''
        ];
        for (const candidate of candidates) {
          if (!candidate || seen.has(candidate)) continue;
          seen.add(candidate);
          results.push(candidate);
        }
      }
      return results;
        }

    function getShareIdFromLocation(){
      try {
        const params = new URLSearchParams(window.location.search);
        const share = params.get('share');
        return typeof share === 'string' ? share.trim() : '';
      } catch {
        return '';
      }
        }

    function ensureShareQueryParam(shareId){
      try {
        const url = new URL(window.location.href);
        if (typeof shareId === 'string' && shareId.trim()) {
          url.searchParams.set('share', shareId.trim());
        } else {
          url.searchParams.delete('share');
        }
        url.hash = '';
        const query = url.searchParams.toString();
        const next = `${url.pathname}${query ? `?${query}` : ''}`;
        window.history.replaceState({}, '', next);
      } catch {
        // ignore URL update failures
      }
        }

    function clearShareQueryParam(){
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('share');
        url.hash = '';
        const query = url.searchParams.toString();
        const next = `${url.pathname}${query ? `?${query}` : ''}`;
        window.history.replaceState({}, '', next);
      } catch {
        const path = (window.location && window.location.pathname) || '/';
        window.history.replaceState({}, '', path);
      }
        }

    function createSharedPlaylistRow(track, idx, options = {}){
      const playlistId = options.playlistId || 'shared';
      const playlistName = options.playlistName || 'Playlist';
      const playlistArt = options.playlistArt || '';
      const shareId = options.shareId || '';
      const li = document.createElement('li');
      li.className = 'track playlist-track public-playlist-track';

      const btnPlay = document.createElement('button');
      btnPlay.type = 'button';
      btnPlay.className = 'btn track-play';

      const srcCandidate = track?.resolvedSrc || track?.mp3 || '';
      const playableCandidate = resolvePlayableSrc(srcCandidate || '');
      const playableSrc = canValidateAudioSrc(playableCandidate) ? playableCandidate : '';
      const audioField = typeof track?.audioField === 'string' ? track.audioField.trim() : '';
      const artworkField = typeof track?.artworkField === 'string' ? track.artworkField.trim() : '';

      li._src = playableSrc;
      li._btn = btnPlay;
      li._card = null;
      li._playlist = playlistId;
      li._audioField = audioField;
      li._valid = null;
      li._validated = false;
      li._validating = false;

      const trackId = track?.trackRecordId || track?.id || '';
      if (trackId) li.dataset.trackId = trackId;

      btnPlay.dataset.playLabel = '▶';
      btnPlay.dataset.pauseLabel = '⏸';

      const trackName = track?.name || `Track ${idx + 1}`;
      const artist = (track?.trackArtist || track?.albumArtist || '').trim();
      const readable = artist ? `${artist} — ${trackName}` : trackName;
      btnPlay.dataset.playAria = `Play ${readable}`;
      btnPlay.dataset.pauseAria = `Pause ${readable}`;

      if (playableSrc) {
        btnPlay.textContent = btnPlay.dataset.playLabel;
        btnPlay.disabled = false;
        btnPlay.classList.remove('btn-error');
        btnPlay.setAttribute('aria-label', btnPlay.dataset.playAria);
      } else {
        btnPlay.textContent = 'No audio';
        btnPlay.disabled = true;
        btnPlay.classList.add('btn-error');
        btnPlay.setAttribute('aria-label', `Audio unavailable for ${readable}`);
      }

      btnPlay.addEventListener('click', () => {
        if (!li._src) {
          window.alert('This track has no playable audio source.');
          return;
        }
        if (li._valid === false) {
          btnPlay.textContent = 'Unavailable';
          btnPlay.disabled = true;
          btnPlay.classList.add('btn-error');
          btnPlay.setAttribute('aria-label', `Audio unavailable for ${readable}`);
          return;
        }
        handlePlay(btnPlay, li, li._src);
        if (li._valid === true || li._validating) return;
        li._validating = true;
        validateAudio(li, li._src, { optimistic: true }).finally(() => {
          li._validating = false;
        });
      });

      const wrapper = document.createElement('span');
      wrapper.className = 'track-name';

      if (artist) {
        const artistLine = document.createElement('span');
        artistLine.className = 'track-name-artist';
        artistLine.textContent = artist;
        wrapper.appendChild(artistLine);

        const titleLine = document.createElement('span');
        titleLine.className = 'track-name-title';
        titleLine.textContent = trackName;
        wrapper.appendChild(titleLine);
      } else {
        const titleLine = document.createElement('span');
        titleLine.className = 'track-name-title';
        titleLine.textContent = trackName;
        wrapper.appendChild(titleLine);
      }

      const tooltipParts = [artist, track?.albumTitle, track?.albumArtist].filter((part) => typeof part === 'string' && part.trim());
      if (tooltipParts.length) {
        const tooltip = tooltipParts.join(' • ');
        wrapper.title = tooltip;
        li.title = tooltip;
      }

      li.appendChild(btnPlay);
      li.appendChild(wrapper);

      const baseMeta = {
        trackName,
        trackArtist: track?.trackArtist || track?.albumArtist || '',
        albumTitle: track?.albumTitle || '',
        albumArtist: track?.albumArtist || '',
        catalogue: track?.catalogue || '',
        playlistId,
        playlistName,
        playlistTrackId: trackId,
        trackRecordId: trackId,
        trackId,
        audioField,
        pictureField: artworkField || 'Artwork::Picture',
        picture: track?.artwork || track?.picture || track?.albumPicture || playlistArt || '',
        albumPicture: track?.albumPicture || track?.artwork || track?.picture || playlistArt || '',
        src: playableSrc,
        mp3: track?.mp3 || '',
        producer: track?.producer || '',
        language: track?.language || '',
        genre: track?.genre || '',
        isrc: track?.isrc || '',
        composer1: track?.composer1 || '',
        composer2: track?.composer2 || '',
        composer3: track?.composer3 || '',
        composer4: track?.composer4 || '',
        composers: Array.isArray(track?.composers) ? track.composers : [],
        albumKey: track?.albumKey || makeAlbumKey(track?.catalogue || '', track?.albumTitle || '', track?.albumArtist || ''),
        shareId,
        source: 'shared-playlist'
      };
      li._meta = baseMeta;

      return li;
        }

    function renderSharedPlaylistView(){
      if (!sharedPlaylistView) return;
      if (!sharedPlaylistActive) {
        sharedPlaylistView.hidden = true;
        if (sharedPlaylistStatus) {
          sharedPlaylistStatus.hidden = true;
          sharedPlaylistStatus.textContent = '';
        }
        resetPlaylistArtwork(sharedPlaylistArt, sharedPlaylistHero);
        if (sharedPlaylistTracks) sharedPlaylistTracks.innerHTML = '';
        if (sharedPlaylistEmpty) sharedPlaylistEmpty.hidden = true;
        if (sharedPlaylistMeta) {
          sharedPlaylistMeta.textContent = '';
          sharedPlaylistMeta.hidden = true;
        }
        if (sharedPlaylistCopyButton) sharedPlaylistCopyButton.disabled = true;
        if (albumsEl) albumsEl.style.display = '';
        if (pagerEl) pagerEl.hidden = false;
        syncPublicFeaturedVisibility();
        return;
      }

      hideLanding();
      sharedPlaylistView.hidden = false;
      if (albumsEl) albumsEl.style.display = 'none';
      if (pagerEl) pagerEl.hidden = true;
      if (errorEl) errorEl.hidden = true;
      syncPublicFeaturedVisibility();

      const playlistName = sharedPlaylistData?.name || 'Playlist';
      if (sharedPlaylistTitle) sharedPlaylistTitle.textContent = playlistName;

      if (sharedPlaylistStatus) {
        if (sharedPlaylistLoading) {
          sharedPlaylistStatus.hidden = false;
          sharedPlaylistStatus.textContent = 'Loading playlist…';
        } else if (sharedPlaylistError) {
          sharedPlaylistStatus.hidden = false;
          sharedPlaylistStatus.textContent = sharedPlaylistError;
        } else {
          sharedPlaylistStatus.hidden = true;
          sharedPlaylistStatus.textContent = '';
        }
      }

      if (sharedPlaylistCopyButton) {
        sharedPlaylistCopyButton.disabled = !sharedPlaylistShareUrl;
      }

      if (sharedPlaylistLoading || sharedPlaylistError || !sharedPlaylistData) {
        resetPlaylistArtwork(sharedPlaylistArt, sharedPlaylistHero);
        if (sharedPlaylistTracks) sharedPlaylistTracks.innerHTML = '';
        if (sharedPlaylistEmpty) sharedPlaylistEmpty.hidden = true;
        if (sharedPlaylistMeta) {
          sharedPlaylistMeta.textContent = '';
          sharedPlaylistMeta.hidden = true;
        }
        return;
      }

      const tracks = Array.isArray(sharedPlaylistData.tracks) ? sharedPlaylistData.tracks : [];
      const shareKey = activeSharedShareId ? `shared:${activeSharedShareId}` : 'shared:playlist';
      const artCandidates = collectSharedPlaylistArtwork(sharedPlaylistData);
      const fallbackArt = artCandidates[0] || '';

      loadPlaylistArtwork(sharedPlaylistArt, sharedPlaylistHero, playlistName, {
        preferredUrls: artCandidates,
        altText: playlistName ? `${playlistName} artwork` : 'Playlist artwork'
      });

      if (sharedPlaylistMeta) {
        const pieces = [];
        pieces.push(`${tracks.length} track${tracks.length === 1 ? '' : 's'}`);
        const sharedAt = sharedPlaylistData.sharedAt || sharedPlaylistData.updatedAt || sharedPlaylistData.createdAt;
        const formatted = formatDateForDisplay(sharedAt);
        if (formatted) pieces.push(`Shared ${formatted}`);
        sharedPlaylistMeta.textContent = pieces.join(' • ');
        sharedPlaylistMeta.hidden = pieces.length === 0;
      }

      if (sharedPlaylistTracks) {
        const previousState = (currentRow && currentRow._playlist === shareKey)
          ? {
              playlistId: currentRow._playlist,
              src: currentRow._src,
              playing: !player.paused && currentSrc === currentRow._src
            }
          : null;
        let matchedPlayback = false;

        sharedPlaylistTracks.innerHTML = '';
        tracks.forEach((track, idx) => {
          const row = createSharedPlaylistRow(track, idx, {
            playlistId: shareKey,
            playlistName,
            playlistArt: fallbackArt,
            shareId: activeSharedShareId
          });
          sharedPlaylistTracks.appendChild(row);

          if (
            row._src &&
            previousState &&
            previousState.src === row._src &&
            previousState.playlistId === shareKey
          ) {
            matchedPlayback = true;
            currentRow = row;
            currentBtn = row._btn || null;
            if (previousState.playing) {
              row.classList.add('playing');
              if (row._btn) {
                row._btn.textContent = row._btn.dataset.pauseLabel || '⏸';
                row._btn.classList.add('btn-accent');
                row._btn.disabled = false;
                if (row._btn.dataset.pauseAria) row._btn.setAttribute('aria-label', row._btn.dataset.pauseAria);
              }
            } else if (row._btn) {
              row._btn.textContent = row._btn.dataset.playLabel || '▶';
              row._btn.classList.remove('btn-accent');
              if (row._btn.dataset.playAria) row._btn.setAttribute('aria-label', row._btn.dataset.playAria);
            }
            setNowPlayingFromRow(row, previousState.playing);
          }
        });

        if (!previousState && nowPlayingInfo.meta && nowPlayingInfo.meta.playlistId === shareKey) {
          const targetSrc = nowPlayingInfo.meta.src || '';
          const candidate = Array.from(sharedPlaylistTracks.children).find((child) => child._src && child._src === targetSrc);
          if (candidate && candidate._btn) {
            currentRow = candidate;
            currentBtn = candidate._btn;
            candidate.classList.toggle('playing', nowPlayingInfo.isPlaying);
          }
        }

        if (previousState && previousState.playlistId === shareKey && !matchedPlayback) {
          if (previousState.playing && !player.paused && currentSrc === previousState.src) {
            player.pause();
          }
          currentSrc = '';
          updateButtonsForStop();
        }
      }

      if (sharedPlaylistEmpty) {
        sharedPlaylistEmpty.hidden = tracks.length > 0;
      }
    }

    async function activateSharedPlaylist(shareId, options = {}){
      const normalized = typeof shareId === 'string' ? shareId.trim() : '';
      if (!normalized) return;
      activeSharedShareId = normalized;
      sharedPlaylistActive = true;
      sharedPlaylistLoading = true;
      sharedPlaylistError = null;
      sharedPlaylistData = null;
      sharedPlaylistShareUrl = '';
      currentMode = 'shared-playlist';
      if (options.updateUrl !== false) {
        ensureShareQueryParam(normalized);
      }
      renderSharedPlaylistView();
      try {
        const res = await fetch(`/api/shared-playlists/${encodeURIComponent(normalized)}`, {
          headers: { 'Accept': 'application/json' }
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 404) {
          sharedPlaylistError = 'This playlist link is no longer available.';
          return;
        }
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || 'Unable to load playlist');
        }
        sharedPlaylistData = data.playlist || null;
        sharedPlaylistShareUrl = typeof data.shareUrl === 'string' && data.shareUrl.trim()
          ? data.shareUrl.trim()
          : buildShareUrlFallback(normalized);
      } catch (err) {
        sharedPlaylistError = err?.message || 'Unable to load playlist';
      } finally {
        sharedPlaylistLoading = false;
        renderSharedPlaylistView();
      }
    }

    function clearSharedPlaylistState({ restoreLanding = false } = {}){
      sharedPlaylistActive = false;
      sharedPlaylistLoading = false;
      sharedPlaylistError = null;
      sharedPlaylistData = null;
      sharedPlaylistShareUrl = '';
      activeSharedShareId = '';
      if (restoreLanding) {
        currentMode = 'landing';
      }
      renderSharedPlaylistView();
    }

    /* ================= Modal behavior ================= */
    function closeTrackInfoModal(options = {}) {
      if (!trackInfoOverlay.classList.contains('open')) return;
      trackInfoOverlay.classList.remove('open');
      trackInfoOverlay.hidden = true;
      trackInfoBody.innerHTML = '';
      document.removeEventListener('keydown', handleTrackInfoKeydown, true);
      if (!options.suppressFocus && trackInfoReturnFocus && typeof trackInfoReturnFocus.focus === 'function') {
        trackInfoReturnFocus.focus();
      }
      trackInfoReturnFocus = null;
      trackInfoFocusables = [];
        }

    function collectTrackMetadata(track){
      if (!track) return [];
      const entries = [];
      const pushEntry = (label, value) => {
        if (value === undefined || value === null) return;
        const text = String(value).trim();
        if (text) entries.push({ label, value: text });
      };
      pushEntry('Producer', track.producer);
      pushEntry('Track Artist', track.trackArtist);
      const composerPartsSet = new Set([
        track.composer1,
        track.composer2,
        track.composer3,
        track.composer4
      ].filter(Boolean).map(value => String(value).trim()).filter(Boolean));
      if (!composerPartsSet.size && Array.isArray(track.composers)) {
        track.composers.forEach((value) => {
          const trimmed = String(value || '').trim();
          if (trimmed) composerPartsSet.add(trimmed);
        });
      }
      if (composerPartsSet.size) {
        pushEntry('Composer', Array.from(composerPartsSet).join(', '));
      }
      pushEntry('Language', track.language);
      pushEntry('Genre', track.genre);
      pushEntry('ISRC', track.isrc);
      return entries;
        }

    function openTrackInfoModal(track, trigger) {
      if (!track) return;
      closeTrackInfoModal({ suppressFocus: true });
      trackInfoReturnFocus = trigger || null;

      const entries = collectTrackMetadata(track);

      if (entries.length) {
        const dl = document.createElement('dl');
        entries.forEach(({ label, value }) => {
          const dt = document.createElement('dt'); dt.textContent = label;
          const dd = document.createElement('dd'); dd.textContent = value;
          dl.appendChild(dt); dl.appendChild(dd);
        });
        trackInfoBody.innerHTML = '';
        trackInfoBody.appendChild(dl);
      } else {
        trackInfoBody.innerHTML = '<p class="info-modal-empty">No additional metadata.</p>';
      }

      trackInfoOverlay.hidden = false;
      trackInfoOverlay.classList.add('open');
      trackInfoFocusables = Array.from(trackInfoDialog.querySelectorAll(trackInfoFocusableSelector));
      if (trackInfoFocusables.length === 0) {
        trackInfoDialog.setAttribute('tabindex', '-1');
        trackInfoFocusables = [trackInfoDialog];
      } else {
        trackInfoDialog.removeAttribute('tabindex');
      }
      const focusTarget = trackInfoFocusables[0] || trackInfoDialog;
      requestAnimationFrame(() => focusTarget.focus());
      document.addEventListener('keydown', handleTrackInfoKeydown, true);
        }

    function handleTrackInfoKeydown(e) {
      if (!trackInfoOverlay.classList.contains('open')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeTrackInfoModal();
        return;
      }
      if (e.key === 'Tab' && trackInfoFocusables.length) {
        const first = trackInfoFocusables[0];
        const last = trackInfoFocusables[trackInfoFocusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
        }

    function closeTracksModal(){
      closeTrackInfoModal({ suppressFocus: true });
      // stop playback when closing
      if (!player.paused) player.pause();
      updateButtonsForStop();
      currentSrc = '';
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
      modalContent.innerHTML = '';
      modalCover.innerHTML = '';
      document.body.classList.remove('no-scroll');
        }

    async function openTracksModal(album, sourceCard=null){
      // Ensure only one window open: close any existing
      closeTracksModal();
      const albumCard = sourceCard || null;
      if (albumCard) {
        albumCard.dataset.validTracks = '0';
        albumCard.dataset.pendingTracks = '0';
        if (albumCard.dataset.hasAudioCandidates === 'true') {
          albumCard.classList.remove('no-audio');
          if (albumCard.title === 'No playable audio available') albumCard.removeAttribute('title');
        } else {
          albumCard.classList.add('no-audio');
          if (!albumCard.title) albumCard.title = 'No playable audio available';
        }
      }

      // Fetch complete album if we might not have all tracks
      let fullAlbum = album;
      const shouldFetchComplete = currentMode === 'explore' || currentMode === 'landing';

      if (shouldFetchComplete && (album.catalogue || album.title)) {
        try {
          const params = new URLSearchParams();
          if (album.catalogue) params.set('cat', album.catalogue);
          if (album.title) params.set('title', album.title);
          if (album.artist) params.set('artist', album.artist);

          const response = await fetch(`/api/album?${params}`);
          if (response.ok) {
            const data = await response.json();
            if (data.items && data.items.length > 0) {
              // Merge the full tracklist
              fullAlbum = { ...album, tracks: data.items };
              console.log(`[openTracksModal] Fetched ${data.items.length} complete tracks for "${album.title}"`);
            }
          }
        } catch (err) {
          console.warn('[openTracksModal] Failed to fetch complete album:', err);
          // Continue with partial album
        }
      }

      // Fill header
      modalTitle.textContent = fullAlbum.title || '(no album)';
      modalArtist.textContent = fullAlbum.artist || '';
      modalCat.textContent = fullAlbum.catalogue || '';
      if (!fullAlbum.catalogue) modalCat.style.display = 'none'; else modalCat.style.display = 'inline-block';

      // Cover
      if (fullAlbum.picture) {
        const wrap = document.createElement('div');
        wrap.className = 'cover-wrap';
        const img = document.createElement('img');
        img.src = `/api/container?u=${encodeURIComponent(fullAlbum.picture)}`;
        img.alt = 'Cover';
        img.loading = 'lazy';
        img.onerror = () => { modalCover.innerHTML = ''; };
        wrap.appendChild(img);
        modalCover.innerHTML = '';
        modalCover.appendChild(wrap);
        modalCover.style.display = 'block';
      } else {
        modalCover.innerHTML = '';
        modalCover.style.display = 'none';
      }

      // Build track list
      const ul = document.createElement('ul');
      ul.className = 'tracks';

      const validTracks = (fullAlbum.tracks || []).filter(t => t.hasValidAudio !== false);
      validTracks.forEach((t, idx) => {
        const li = document.createElement('li');
        li.className = 'track';

        const top = document.createElement('div');
        top.className = 'track-top';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'track-title';
        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = t.name || 'Untitled track';
        titleWrap.appendChild(name);
        if (t.trackArtist) {
          const artistLine = document.createElement('div');
          artistLine.className = 'artist';
          artistLine.textContent = t.trackArtist;
          titleWrap.appendChild(artistLine);
        }

        top.appendChild(titleWrap);

        const controls = document.createElement('div');
        controls.className = 'controls';

        const btnPlay = document.createElement('button');
        btnPlay.className = 'btn small';
        const playableCandidate = resolvePlayableSrc(t.mp3);
        const canPlay = canValidateAudioSrc(playableCandidate);
        const playableSrc = canPlay ? playableCandidate : '';
        li._src = playableSrc;
        li._btn = btnPlay;
        li._card = albumCard;
        li._playlist = null;
        li._audioField = t.mp3Field || '';
        const baseMetaAlbum = { ...t };
        baseMetaAlbum.trackName = t.name || 'Untitled track';
        baseMetaAlbum.trackArtist = t.trackArtist || fullAlbum.artist || '';
        baseMetaAlbum.albumTitle = fullAlbum.title || '';
        baseMetaAlbum.albumArtist = fullAlbum.artist || '';
        baseMetaAlbum.playlistId = null;
        baseMetaAlbum.playlistName = '';
        baseMetaAlbum.picture = fullAlbum.picture || '';
        baseMetaAlbum.source = 'album';
        baseMetaAlbum.catalogue = fullAlbum.catalogue || '';
        baseMetaAlbum.audioField = t.mp3Field || '';
        baseMetaAlbum.trackRecordId = t.recordId || '';
        baseMetaAlbum.pictureField = fullAlbum.pictureField || t.pictureField || '';
        baseMetaAlbum.src = playableSrc;
        li._meta = baseMetaAlbum;
        li._validated = false;
        li._valid = null;
        li._validating = false;
        if (canPlay) {
          btnPlay.textContent = '▶ Play';
          btnPlay.disabled = false;
          btnPlay.classList.remove('btn-error');
          btnPlay.removeAttribute('title');
        } else if (t.mp3) {
          btnPlay.textContent = 'Invalid audio';
          btnPlay.disabled = true;
          btnPlay.classList.add('btn-error');
          btnPlay.title = 'Invalid audio link';
        } else {
          btnPlay.textContent = 'No audio';
          btnPlay.disabled = true;
          btnPlay.classList.add('btn-error');
          btnPlay.title = 'Audio missing';
        }
        btnPlay.addEventListener('click', async () => {
          if (!li._src) return;
          if (li._valid === false) {
            btnPlay.textContent = 'Unavailable';
            btnPlay.disabled = true;
            btnPlay.classList.add('btn-error');
            return;
          }

          handlePlay(btnPlay, li, li._src);

          if (li._valid === true || li._validating) return;

          li._validating = true;
          validateAudio(li, li._src, { optimistic: true }).finally(() => {
            li._validating = false;
          });
        });
        controls.appendChild(btnPlay);

        const btnAdd = document.createElement('button');
        btnAdd.type = 'button';
        btnAdd.className = 'btn small';
        btnAdd.textContent = 'Add to playlist';
        btnAdd.addEventListener('click', () => handleAddToPlaylist(album, t, playableSrc));
        controls.appendChild(btnAdd);

        const hasInfo = Boolean(
          t.producer ||
          t.trackArtist ||
          t.composer1 ||
          t.composer2 ||
          t.composer3 ||
          t.composer4 ||
          (Array.isArray(t.composers) && t.composers.some(value => String(value || '').trim())) ||
          t.language ||
          t.genre ||
          t.isrc
        );
        if (hasInfo) {
          const infoBtn = document.createElement('button');
          infoBtn.type = 'button';
          infoBtn.className = 'btn small info-more';
          infoBtn.setAttribute('aria-label', 'More info');
          infoBtn.innerHTML = '<span aria-hidden="true">⋮</span>';
          infoBtn.addEventListener('click', () => openTrackInfoModal(t, infoBtn));
          controls.appendChild(infoBtn);
        }

        top.appendChild(controls);

        li.appendChild(top);

        // Progress UI (non-destructive)
        const progWrap = document.createElement('div');
        progWrap.className = 'progress';
        const seek = document.createElement('input');
        seek.type = 'range'; seek.className = 'seek'; seek.min = 0; seek.max = 100; seek.value = 0;
        const time = document.createElement('div');
        time.className = 'time'; time.textContent = '0:00 / 0:00';
        progWrap.appendChild(seek); progWrap.appendChild(time);
        li.appendChild(progWrap);
        li._seek = seek; li._time = time; li._seeking = false;
        // Seek while dragging (works while playing or paused)
        seek.addEventListener('input', () => {
          if (currentRow === li && player.duration && isFinite(player.duration)) {
            const pct = Number(seek.value) / 100;
            player.currentTime = pct * player.duration;
          }
        });
        seek.addEventListener('change', () => {
          if (currentRow === li && player.duration && isFinite(player.duration)) {
            const pct = Number(seek.value) / 100;
            player.currentTime = pct * player.duration;
          }
          li._seeking = false;
        });
        seek.addEventListener('pointerdown', () => { if (currentRow === li) li._seeking = true; });
        seek.addEventListener('pointerup',   () => { if (currentRow === li) li._seeking = false; });

        ul.appendChild(li);
      });

      modalContent.innerHTML = '';
      if (Array.isArray(fullAlbum?.tracks) && fullAlbum.tracks.length) {
        const albumActions = document.createElement('div');
        albumActions.className = 'album-actions';
        const btnAddAlbum = document.createElement('button');
        btnAddAlbum.type = 'button';
        btnAddAlbum.className = 'btn small btn-accent';
        btnAddAlbum.textContent = `Add album to playlist (${fullAlbum.tracks.length} tracks)`;
        btnAddAlbum.addEventListener('click', async () => {
          const previousLabel = btnAddAlbum.textContent;
          btnAddAlbum.disabled = true;
          btnAddAlbum.textContent = 'Adding…';
          try {
            await handleAddAlbumToPlaylist(fullAlbum);
          } finally {
            btnAddAlbum.disabled = false;
            btnAddAlbum.textContent = previousLabel;
          }
        });
        albumActions.appendChild(btnAddAlbum);
        modalContent.appendChild(albumActions);
      }
      modalContent.appendChild(ul);

      // Open
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('no-scroll');
        }

    modalClose.addEventListener('click', closeTracksModal);
    overlay.addEventListener('click', (e) => {
      // Close if clicking backdrop (but not clicks inside the dialog)
      if (e.target === overlay) closeTracksModal();
        });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (overlay.classList.contains('open')) {
        closeTracksModal();
        return;
      }
      if (authOverlay && !authOverlay.hidden) {
        closeAuth();
      }
        });

    trackInfoOverlay.addEventListener('click', (e) => {
      if (e.target === trackInfoOverlay) closeTrackInfoModal();
        });
    trackInfoClose.addEventListener('click', () => closeTrackInfoModal());

    if (authOverlay) {
      authOverlay.addEventListener('click', (event) => {
        if (event.target === authOverlay) closeAuth();
      });
    }
    if (authClose) authClose.addEventListener('click', () => closeAuth());
    if (shareModalClose) shareModalClose.addEventListener('click', () => closeShareModal());
    if (shareModal) {
      shareModal.addEventListener('click', (e) => {
        if (e.target === shareModal) closeShareModal();
      });
    }
    if (authForm) authForm.addEventListener('submit', submitAuthForm);
    if (authSwitch) {
      authSwitch.addEventListener('click', () => {
        const nextMode = authMode === 'login' ? 'register' : 'login';
        setAuthMode(nextMode);
        queueTask(() => authEmail?.focus());
      });
    }
    if (loginTrigger) {
      loginTrigger.addEventListener('click', () => openAuth('login', loginTrigger));
    }
    if (signupTrigger) {
      signupTrigger.addEventListener('click', () => openAuth('register', signupTrigger));
    }
    if (logoutButton) {
      logoutButton.addEventListener('click', performLogout);
    }
    if (playlistCreateForm) {
      playlistCreateForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!currentUser) {
          openAuth('login', playlistCreateForm.querySelector('button'));
          return;
        }
        const name = (playlistNameInput?.value || '').trim();
        if (!name) return;
        try {
          const playlist = await createPlaylistOnServer(name);
          if (playlistNameInput) playlistNameInput.value = '';
          if (playlist?.id) setActivePlaylist(playlist.id);
        } catch (err) {
          window.alert(err?.message || 'Unable to create playlist');
        }
      });
    }
    if (deletePlaylistButton) {
      deletePlaylistButton.addEventListener('click', () => {
        if (deletePlaylistButton.disabled) return;
        deleteActivePlaylist();
      });
    }
    if (sharePlaylistButton) {
      sharePlaylistButton.addEventListener('click', () => {
        if (sharePlaylistButton.disabled) return;
        copyActivePlaylistShareLink();
      });
    }
    if (shareLinkOutput) {
      shareLinkOutput.addEventListener('click', async () => {
        const raw = shareLinkOutput.dataset.url || '';
        const url = raw.trim();
        if (!url) return;
        const copied = await copyTextToClipboard(url);
        if (copied) {
          window.alert('Share link copied to your clipboard.');
        } else {
          window.alert(`Share link:\n${url}`);
        }
      });
    }
    if (sharedPlaylistBackButton) {
      sharedPlaylistBackButton.addEventListener('click', () => {
        clearShareQueryParam();
        clearSharedPlaylistState({ restoreLanding: true });
        showLanding();
      });
    }
    if (sharedPlaylistCopyButton) {
      sharedPlaylistCopyButton.addEventListener('click', () => {
        if (sharedPlaylistCopyButton.disabled) return;
        const link = sharedPlaylistShareUrl || buildShareUrlFallback(activeSharedShareId);
        if (!link) {
          window.alert('No share link available');
          return;
        }
        showShareModal(link);
      });
    }
    if (togglePlaylistTracksButton) {
      togglePlaylistTracksButton.addEventListener('click', () => {
        playlistTracksCollapsed = !playlistTracksCollapsed;
        if (playlistTracksCollapsed && playlistTracksSection) playlistTracksSection.classList.remove('only-current');
        renderPlaylistTracks();
      });
    }
    if (nowPlayingCollapseButton) {
      nowPlayingCollapseButton.addEventListener('click', () => {
        nowPlayingCollapsed = !nowPlayingCollapsed;
        updateNowPlayingUI();
      });
    }
    if (nowPlayingToggleButton) {
      nowPlayingToggleButton.addEventListener('click', () => {
        if (!nowPlayingInfo.meta) return;
        const meta = nowPlayingInfo.meta;
        if (player.paused) {
          if (!currentRow && meta.playlistId && meta.playlistTrackId && playlistTracksList) {
            const candidate = playlistTracksList.querySelector(`[data-track-id="${meta.playlistTrackId}"]`);
            if (candidate) {
              currentRow = candidate;
              currentBtn = candidate._btn || null;
            }
          }
          if (meta.src && player.src !== meta.src) {
            player.src = meta.src;
            currentSrc = meta.src;
          }
          player.play()
            .then(() => {
              if (currentRow) {
                setNowPlayingFromRow(currentRow, true);
                if (currentRow._btn) {
                  currentBtn = currentRow._btn;
                  currentBtn.disabled = false;
                  const pauseLabel = currentBtn.dataset?.pauseLabel || '⏸ Pause';
                  currentBtn.textContent = pauseLabel;
                  if (currentBtn.dataset?.pauseAria) currentBtn.setAttribute('aria-label', currentBtn.dataset.pauseAria);
                  currentBtn.classList.add('btn-accent');
                }
                currentRow.classList.remove('loading');
                currentRow.classList.add('playing');
                updateProgressUI();
              } else {
                setNowPlayingFromRow({ _meta: meta, _src: meta.src }, true);
              }
            })
            .catch((err) => {
              console.warn('Resume playback failed:', err);
              window.alert('Unable to resume playback.');
            });
        } else {
          player.pause();
        }
      });
    }

    setAuthMode('login');
    updateAuthUI();
    refreshCurrentUser();
    loadPublicPlaylistSummaries();

    /* ================= Rendering albums (cards) ================= */
    function renderAlbumPage(){
      // Hide loading indicator when rendering
      if (loadingIndicator) loadingIndicator.hidden = true;
      if (albumsEl) albumsEl.style.display = '';

      albumsEl.innerHTML = '';

      const validAlbums = [];
      const pendingQueue = [];
      const invalidAlbums = [];
      let pendingAlbums = 0;

      for (const album of albumGroups) {
        if (!album) continue;
        const key = album.key || makeAlbumKey(album.catalogue, album.title, album.artist);
        album.key = key;
        const state = albumAudioState.get(key);
        if (!state) {
          ensureAlbumAudioValidation(album);
          pendingAlbums += 1;
          pendingQueue.push(album);
          continue;
        }
        if (state.status === 'pending') {
          album._pendingValidation = true;
          pendingAlbums += 1;
          pendingQueue.push(album);
          continue;
        }
        if (state.status === 'valid') {
          if (isFresh(state)) {
            album._pendingValidation = false;
            validAlbums.push(album);
          } else {
            albumAudioState.delete(key);
            ensureAlbumAudioValidation(album);
            pendingAlbums += 1;
            pendingQueue.push(album);
          }
          continue;
        }
        if (state.status === 'invalid') {
          if (!isFresh(state)) {
            albumAudioState.delete(key);
            ensureAlbumAudioValidation(album);
            pendingAlbums += 1;
            pendingQueue.push(album);
          } else {
            // Invalid but fresh - add to invalidAlbums if toggle is on
            album._noAudio = true;
            invalidAlbums.push(album);
          }
        }
      }

      pendingAlbums = pendingQueue.length;

      let displayAlbums = validAlbums.concat(pendingQueue);
      if (showAlbumsWithoutAudio) {
        displayAlbums = displayAlbums.concat(invalidAlbums);
      }
      if (activePublicPlaylist) {
        const activeKey = activePublicPlaylist.toLowerCase();
        const matchesActivePlaylist = (album) => Array.isArray(album?.publicPlaylists)
          && album.publicPlaylists.some((name) => String(name || '').toLowerCase() === activeKey);
        displayAlbums = displayAlbums.filter(matchesActivePlaylist);
        pendingAlbums = pendingQueue.filter(matchesActivePlaylist).length;
      }

      const totalAlbums = displayAlbums.length;
      const availableAlbums = activePublicPlaylist ? totalAlbums : (albumGroups.length || totalAlbums);

      if (availableAlbums > 0) {
        errorEl.hidden = true;
      } else if (activePublicPlaylist) {
        errorEl.hidden = true;
      } else if (pendingAlbums === 0 && albumGroups.length > 0) {
        if (!showAlbumsWithoutAudio && invalidAlbums.length > 0) {
          errorEl.hidden = false;
          errorEl.textContent = `Found ${invalidAlbums.length} album${invalidAlbums.length !== 1 ? 's' : ''} but audio is unavailable. Enable "Show all" to view.`;
        } else {
          errorEl.hidden = false;
          errorEl.textContent = 'No albums with complete audio and artwork are available right now.';
        }
      } else if (pendingAlbums > 0) {
        errorEl.hidden = true;
      }

      if (totalAlbums === 0) {
        albumsEl.classList.remove('single-album');
      }

      if (totalAlbums === 0 && pendingAlbums > 0) {
        countEl.textContent = 'Validating audio…';
      } else if (activePublicPlaylist) {
        countEl.textContent = '';
      } else {
        countEl.textContent = availableAlbums ? `Albums: ${availableAlbums}` : (lastQ ? 'No albums' : '');
      }

      const totalPool = Math.max(availableAlbums, displayAlbums.length);
      const maxPage = Math.max(1, Math.ceil(Math.max(totalPool, 1) / ALBUMS_PER_PAGE));
      albumPage = Math.min(albumPage, maxPage - 1);

      // Show shuffle button for explore mode, pagination for search mode
      const isExploreMode = currentMode === 'explore' || currentMode === 'landing';
      console.log(`[renderAlbumPage] mode=${currentMode}, isExploreMode=${isExploreMode}, shuffleBtn=${!!shuffleBtn}`);
      if (isExploreMode) {
        pagerEl.hidden = true;
        if (shuffleBtn) shuffleBtn.hidden = false;
      } else {
        pagerEl.hidden = totalPool <= ALBUMS_PER_PAGE;
        if (shuffleBtn) shuffleBtn.hidden = true;
        pageInfo.textContent = `Page ${albumPage + 1} / ${maxPage}`;
        prevEl.disabled = albumPage <= 0;
        nextEl.disabled = albumPage >= maxPage - 1 && rawItems.length >= rawTotalFound;
      }

      // Debug pagination
      if (totalPool > ALBUMS_PER_PAGE && !isExploreMode) {
        console.log(`[PAGINATION] Showing pager: ${totalPool} albums (${maxPage} pages)`);
      }

      if (totalAlbums === 0 && pendingAlbums > 0) {
        const wait = document.createElement('div');
        wait.className = 'muted';
        wait.textContent = 'Validating audio availability…';
        albumsEl.appendChild(wait);
        return;
      }

      if (totalAlbums === 0) {
        // Don't show error message for public playlists
        return;
      }

      const start = albumPage * ALBUMS_PER_PAGE;
      const end = Math.min(start + ALBUMS_PER_PAGE, totalAlbums);
      let pageAlbums = displayAlbums.slice(start, end);

      // Always pad to exactly 8 slots for consistent layout
      if (pageAlbums.length < 8) {
        pageAlbums = pageAlbums.concat(Array(8 - pageAlbums.length).fill(null));
      }

      if (currentMode !== 'search' && pageAlbums.filter(a => a).length === 1) {
        albumsEl.classList.add('single-album');
      } else {
        albumsEl.classList.remove('single-album');
      }

      pageAlbums.forEach(album => {
        const card = document.createElement('div');

        // Handle empty slots
        if (!album) {
          card.className = 'card';
          card.style.visibility = 'hidden';
          albumsEl.appendChild(card);
          return;
        }

        const key = album.key || makeAlbumKey(album.catalogue, album.title, album.artist);
        album.key = key;
        card.className = 'card';
        card.dataset.albumKey = key;
        album._card = card;
        const candidateTracks = Array.isArray(album.tracks) ? album.tracks.filter(track => hasValidMp3(track.mp3) && track.hasValidAudio) : [];
        const hasPlayable = album && album.hasPlayable;
        const hasCandidates = hasPlayable !== undefined ? hasPlayable : candidateTracks.length > 0;
        card.dataset.hasAudioCandidates = hasCandidates ? 'true' : 'false';
        card.dataset.validTracks = hasPlayable ? '1' : '0';
        card.dataset.pendingTracks = album._pendingValidation ? '1' : '0';
        if (hasCandidates) {
          card.classList.remove('no-audio');
          card.removeAttribute('title');
        } else {
          card.classList.add('no-audio');
          card.title = 'No playable audio available';
        }

        if (album._pendingValidation) {
          card.classList.add('pending-audio');
          if (!card.title) card.title = 'Validating audio availability…';
        }

        if (totalAlbums === 1 && prevSearch) {
          const backWrap = document.createElement('div');
          backWrap.className = 'back-row';
          const backBtn = document.createElement('button');
          backBtn.type = 'button';
          backBtn.className = 'btn small';
          backBtn.textContent = prevSearch.type === 'explore' ? 'Back to explore results' : 'Back to search results';
          backBtn.addEventListener('click', () => restorePreviousSearch());
          backWrap.appendChild(backBtn);
          card.appendChild(backWrap);
        }



        if (album.picture) {
          const proxied = `/api/container?u=${encodeURIComponent(album.picture)}`;
          const wrap = document.createElement('div');
          wrap.className = 'cover-wrap';
          const img = document.createElement('img');
          img.src = proxied;
          img.alt = 'Cover';
          img.loading = 'lazy';
          img.onerror = () => { wrap.remove(); };
          wrap.appendChild(img);
          wrap.tabIndex = 0;
          wrap.setAttribute('role','button');
          try { wrap.setAttribute('aria-label', `Open tracks for ${album.title}`); } catch {}
          const triggerSearch = () => {
            if (totalAlbums > 1) {
              const term = album.title || '';
              if (searchEl) searchEl.value = term;
              run(term);
            } else {
              openTracksModal(album, card);
            }
          };
          wrap.addEventListener('click', triggerSearch);
          wrap.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ' ) {
              e.preventDefault();
              triggerSearch();
            }
          });
          card.appendChild(wrap);
        }

        const heading = document.createElement('div');
        heading.className = 'heading';
        const h3 = document.createElement('h3');
        h3.textContent = album.title;
        heading.appendChild(h3);

        if (album.catalogue) {
          const cat = document.createElement('span');
          cat.className = 'badge';
          cat.textContent = album.catalogue;
          heading.appendChild(cat);
        }

        // Add "No Audio" badge for albums shown via toggle
        if (album._noAudio) {
          const noAudioBadge = document.createElement('span');
          noAudioBadge.className = 'badge badge-warning';
          noAudioBadge.textContent = 'No Audio';
          noAudioBadge.title = 'This album does not have playable audio files';
          heading.appendChild(noAudioBadge);
        }

        card.appendChild(heading);

        const muted = document.createElement('div');
        muted.className = 'muted';
        muted.textContent = album.artist;
        card.appendChild(muted);

        const toggle = document.createElement('button');
        toggle.className = 'btn small';
        toggle.textContent = `Show Tracks (${album.tracks.length})`;
        toggle.addEventListener('click', () => openTracksModal(album, card));
        card.appendChild(toggle);

        albumsEl.appendChild(card);
        updateAlbumCardState(album);
      });

      if (shouldScrollAlbums && currentMode === 'search') {
        if (albumsEl) {
          const targetEl = albumsEl.firstElementChild || albumsEl;
          if (targetEl && typeof targetEl.scrollIntoView === 'function') {
            shouldScrollAlbums = false;
            try {
              targetEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
            } catch {
              targetEl.scrollIntoView();
            }
          } else if (typeof window !== 'undefined') {
            shouldScrollAlbums = false;
            try {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            } catch {
              window.scrollTo(0, 0);
            }
          }
        } else {
          shouldScrollAlbums = false;
        }
      }

      // Removed performance logging overhead
    }

    function updateProgressUI(){
      if (!currentRow) return;
      const seek = currentRow._seek, time = currentRow._time;
      if (!seek || !time) return;
      const dur = player.duration, cur = player.currentTime;
      const pct = (dur && isFinite(dur)) ? Math.min(100, Math.max(0, (cur/dur)*100)) : 0;
      if (!(currentRow && currentRow._seeking)) { seek.value = String(pct); seek.style.setProperty('--fill', pct + '%'); }
      if (nowPlayingProgressFill) {
        nowPlayingProgressFill.style.width = pct + '%';
      }
      time.textContent = fmtTime(cur) + ' / ' + fmtTime(dur);
        }

    function handlePlay(btn, row, src){
      if (!src) return;
      if (currentSrc === src && !player.paused) {
        player.pause();
        return;
      }

      const resumingSameTrack = currentSrc === src && player.paused;
      if (currentSrc !== src) {
        player.src = src;
      }
      currentSrc = src;

      if (!resumingSameTrack) {
        updateButtonsForStop();
      }
      setNowPlayingFromRow(row, false);

      currentBtn = btn;
      currentRow = row;
      if (currentRow) {
        currentRow.classList.remove('playing');
        currentRow.classList.add('loading');
      }
      btn.disabled = true;
      btn.textContent = btn.dataset.loadingLabel || 'Loading…';
      if (btn.dataset.playAria) btn.setAttribute('aria-label', 'Loading track…');
      btn.classList.add('btn-accent');
      btn.classList.remove('btn-error');

      player.play()
        .then(() => {
          if (!resumingSameTrack) {
            updateButtonsForStop();
          }
          currentBtn = btn;
          currentRow = row;
          if (currentRow) {
            currentRow.classList.remove('loading');
            currentRow.classList.add('playing');
          }
          btn.disabled = false;
          btn.textContent = btn.dataset.pauseLabel || '⏸ Pause';
          if (btn.dataset.pauseAria) btn.setAttribute('aria-label', btn.dataset.pauseAria);
          btn.classList.add('btn-accent');
          updateProgressUI();
          scheduleNextTrackPreload(currentRow);
          setNowPlayingFromRow(row, true);
        })
        .catch((err) => {
          console.warn('Playback error:', err);
          try {
            player.removeAttribute('src');
            player.load();
          } catch {}
          currentSrc = '';
          updateButtonsForStop();
          markNowPlayingInactive();
        });
    }
    function updateButtonsForStop(){
      if (currentRow) {
        currentRow.classList.remove('playing');
        currentRow.classList.remove('loading');
      }
      if (currentBtn) {
        currentBtn.disabled = false;
        const playLabel = currentBtn.dataset?.playLabel || '▶ Play';
        currentBtn.textContent = playLabel;
        if (currentBtn.dataset?.playAria) currentBtn.setAttribute('aria-label', currentBtn.dataset.playAria);
        currentBtn.classList.remove('btn-accent');
      }
      currentBtn = null; currentRow = null;
      markNowPlayingInactive();
      if (nowPlayingProgressFill) {
        nowPlayingProgressFill.style.width = '0%';
      }
        }
    function playNextTrackFromPlaylistMeta(meta){
      if (!meta || !meta.playlistId) return false;
      const playlist = playlists.find((p) => p && p.id === meta.playlistId);
      if (!playlist) return false;
      const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
      if (!tracks.length) return false;

      const currentIdx = tracks.findIndex((t) => {
        if (!t) return false;
        if (meta.playlistTrackId && t.id === meta.playlistTrackId) return true;
        if (meta.trackRecordId && t.trackRecordId === meta.trackRecordId) return true;
        return false;
      });

      let nextCandidate = null;
      for (let i = currentIdx + 1; i < tracks.length; i++) {
        const candidate = tracks[i];
        if (!candidate) continue;
        const raw = candidate.resolvedSrc || candidate.mp3 || '';
        if (canValidateAudioSrc(resolvePlayableSrc(raw))) {
          nextCandidate = candidate;
          break;
        }
      }
      if (!nextCandidate) return false;

      if (activePlaylistId !== playlist.id) {
        activePlaylistId = playlist.id;
        /* keep collapsed by default */ playlistTracksCollapsed = playlistTracksCollapsed;
        renderPlaylistsPanel();
      } else if (!playlistTracksList || !playlistTracksList.children.length) {
        renderPlaylistTracks();
      }

      if (!playlistTracksList) return false;

      const selectors = [];
      if (nextCandidate.id) selectors.push('[data-track-id="' + nextCandidate.id + '"]');
      if (nextCandidate.trackRecordId) selectors.push('[data-track-id="' + nextCandidate.trackRecordId + '"]');

      let nextRow = null;
      for (const sel of selectors) {
        nextRow = playlistTracksList.querySelector(sel);
        if (nextRow) break;
      }
      if (!nextRow) {
        nextRow = playlistTracksList.querySelector('.playlist-track');
        while (nextRow && !nextRow._src) {
          nextRow = findNextPlayableRow(nextRow);
        }
      }

      if (nextRow && nextRow._btn && nextRow._src) {
        handlePlay(nextRow._btn, nextRow, nextRow._src);
        return true;
      }
      return false;
        }

    function playNextPlayableFrom(anchor){
      if (!anchor) return false;
      let candidate = findNextPlayableRow(anchor);
      while (candidate && !candidate._src) {
        candidate = findNextPlayableRow(candidate);
      }
      if (candidate && candidate._btn && candidate._src) {
        handlePlay(candidate._btn, candidate, candidate._src);
        return true;
      }
      return false;
        }

    player.addEventListener('seeking', () => {
      seekStartPosition = Number.isFinite(player.currentTime) ? player.currentTime : seekStartPosition;
    });
    player.addEventListener('seeked', () => {
      const to = Number.isFinite(player.currentTime) ? player.currentTime : 0;
      const delta = Math.abs(to - seekStartPosition);
      sendStreamEvent('SEEK', getCurrentTrackMeta(), to, player.duration, delta);
    });

    player.addEventListener('ended', () => {
      const meta = getCurrentTrackMeta();
      const duration = Number.isFinite(player.duration) ? player.duration : 0;
      const endedPosition = Number.isFinite(player.currentTime) ? player.currentTime : duration;
      const finalPosition = duration || endedPosition;
      const delta = Math.abs((finalPosition || 0) - lastStreamReportPos);
      sendStreamEvent('END', meta, finalPosition, duration || finalPosition, delta);
      const nextLi = currentRow ? findNextPlayableRow(currentRow) : null;
      if (nextLi && nextLi._btn && nextLi._src) {
        handlePlay(nextLi._btn, nextLi, nextLi._src);
        return;
      }

      // Fallback: attempt to locate the next playlist item if the DOM was re-rendered
      if (!nextLi && nowPlayingInfo.meta?.playlistId && playlistTracksList) {
        const selector = nowPlayingInfo.meta.playlistTrackId
          ? `[data-track-id="${nowPlayingInfo.meta.playlistTrackId}"]`
          : null;
        let anchor = selector ? playlistTracksList.querySelector(selector) : null;
        if (!anchor && currentRow && currentRow._playlist === nowPlayingInfo.meta.playlistId) {
          anchor = currentRow;
        }
        if (!anchor) {
          const first = playlistTracksList.querySelector('.playlist-track');
          anchor = first || null;
        }
        if (anchor) {
          let candidate = findNextPlayableRow(anchor);
          while (candidate && !candidate._src) {
            candidate = findNextPlayableRow(candidate);
          }
          if (candidate && candidate._btn && candidate._src) {
            handlePlay(candidate._btn, candidate, candidate._src);
            return;
          }
        }
      }
      if (playNextTrackFromPlaylistMeta(nowPlayingInfo.meta)) {
        return;
      }

      updateButtonsForStop();
      currentSrc = '';
      updateProgressUI();
      markNowPlayingInactive();
      if (nowPlayingProgressFill) nowPlayingProgressFill.style.width = '0%';
    });
    player.addEventListener('timeupdate', () => {
      updateProgressUI();
      const now = Date.now();
      if (!lastProgressAttemptTs || now - lastProgressAttemptTs >= STREAM_PROGRESS_INTERVAL_MS) {
        lastProgressAttemptTs = now;
        sendStreamEvent('PROGRESS', getCurrentTrackMeta());
      }
    });
    player.addEventListener('loadedmetadata', () => { updateProgressUI(); });
    player.addEventListener('pause', () => {
      if (!player.ended) {
        sendStreamEvent('PAUSE', getCurrentTrackMeta(), player.currentTime, player.duration);
      }
      if (currentBtn && currentSrc === player.src) {
        const playLabel = currentBtn.dataset?.playLabel || '▶ Play';
        currentBtn.textContent = playLabel;
        if (currentBtn.dataset?.playAria) currentBtn.setAttribute('aria-label', currentBtn.dataset.playAria);
        currentBtn.classList.remove('btn-accent');
        if (currentRow) currentRow.classList.remove('playing');
      }
      if (currentRow) setNowPlayingFromRow(currentRow, false);
      else markNowPlayingInactive();
        });
    player.addEventListener('play', () => {
      sendStreamEvent('PLAY', getCurrentTrackMeta(), player.currentTime, player.duration);
      if (currentBtn && currentSrc === player.src) {
        const pauseLabel = currentBtn.dataset?.pauseLabel || '⏸ Pause';
        currentBtn.textContent = pauseLabel;
        if (currentBtn.dataset?.pauseAria) currentBtn.setAttribute('aria-label', currentBtn.dataset.pauseAria);
        currentBtn.classList.add('btn-accent');
        if (currentRow) currentRow.classList.add('playing');
      }
      if (currentRow) setNowPlayingFromRow(currentRow, true);
    });
    player.addEventListener('error', () => {
      sendStreamEvent('ERROR', getCurrentTrackMeta(), player.currentTime, player.duration);
      const err = player.error;
      if (err) {
        console.warn('[MASS] Audio element error', { code: err.code, message: err.message });
      } else {
        console.warn('[MASS] Audio element encountered an unknown error');
      }
    });

    /* ================= Lazy-load FM rows ================= */
    async function loadMore(q){
      showBusy('Loading more…');
      try {
        if (rawItems.length >= rawTotalFound) return false; // nothing left
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        params.set('offset', rawNextOffset);
        params.set('limit', FM_FETCH_LIMIT);
        const r = await fetch(`/api/search?${params}`);
        if (!r.ok) throw new Error(await r.text().catch(()=>`HTTP ${r.status}`));
        const j = await r.json();
        const newItems = j.items || [];
        rawItems = rawItems.concat(newItems);
        rawTotalFound = Number(j.total || rawTotalFound);
        const returnedOffset = Number(j.offset || 0);
        rawNextOffset = returnedOffset + newItems.length;
        albumGroups = groupAlbums(rawItems);
        // Skip audio validation for faster loads
        // primeAlbumAudioValidation(albumGroups);
        refreshPublicPlaylists();
        return newItems.length > 0;
      } finally {
        hideBusy();
      }
        }
    /* ================= Search & paging ================= */
    function shuffleInPlace(arr){
      for(let i=arr.length-1;i>0;i--){ const j=(Math.random()* (i+1))|0; [arr[i],arr[j]]=[arr[j],arr[i]]; }
        }

    function closeExplorePanel(){
      if (explorePanel) explorePanel.setAttribute('hidden', '');
      if (exploreEl) exploreEl.setAttribute('aria-expanded', 'false');
    }

    function handleExploreSearch(term){
      if (typeof term !== 'string' || !term.trim()) return;
      const value = term.trim();
      if (searchEl) searchEl.value = value;
      closeExplorePanel();
      run(value);
    }

    function syncPublicFeaturedVisibility(){
      if (!publicFeaturedRow) return;
      if (currentMode === 'search') {
        publicFeaturedRow.setAttribute('hidden', '');
        return;
      }
      if (sharedPlaylistActive) {
        publicFeaturedRow.setAttribute('hidden', '');
        return;
      }
      const panelHidden = !publicPlaylistsPanel || publicPlaylistsPanel.hidden;
      const viewHidden = !publicPlaylistView || publicPlaylistView.hidden;
      if (panelHidden && viewHidden) publicFeaturedRow.setAttribute('hidden', '');
      else publicFeaturedRow.removeAttribute('hidden');
    }

    async function runExplore(startYear){
      // Ensure explore layout class is applied so Featured Playlists render below albums
      try {
        const contentCol = document.querySelector('.content-column');
        contentCol && contentCol.classList.add('exploring');
        if (publicFeaturedRow) publicFeaturedRow.removeAttribute('hidden');
      } catch {}

      // Restore playlists when leaving search (explore)
      try {
        if (playlistColumn) playlistColumn.hidden = !Boolean(currentUser);
        if (publicFeaturedRow) publicFeaturedRow.removeAttribute('hidden');
      } catch {}

      const restoringThisRun = isRestoring;
      if (!isRestoring) {
        if (albumGroups.length || rawItems.length) {
          const snapshot = snapshotState();
          prevSearch = { type: snapshot.mode || currentMode, start: startYear, snapshot };
        } else {
          prevSearch = null;
        }
      }
      showBusy(`Loading ${startYear}s…`);
      hideLanding();
      closeExplorePanel();
      // small guard
      const start = Number(startYear)||0;
      if(!start){
        if (restoringThisRun) isRestoring = false;
        return;
      }
      const end = start + 9;
      const params = new URLSearchParams();
      params.set('start', String(start));
      params.set('end',   String(end));
      params.set('limit', '150'); // Balanced: enough albums without timing out
      try {
        const r = await fetch(`/api/explore?${params}`);
        if (!r.ok) {
          errorEl.hidden = false;
          errorEl.textContent = 'Explore error: ' + await r.text();
          return;
        }

        const j = await r.json();
        if (!j || !Array.isArray(j.items) || j.items.length === 0){
          errorEl.hidden = false;
          errorEl.textContent = `No albums found for the ${start}s.`;
          rawItems = [];
          rawTotalFound = 0;
          rawNextOffset = 0;
          albumGroups = [];
          albumPage = 0;
          activePublicPlaylist = null;
          refreshPublicPlaylists();
          renderAlbumPage();
          return;
        }

        rawItems = j.items || [];
        rawTotalFound = Number(j.total || rawItems.length);
        rawNextOffset = 0;
        activePublicPlaylist = null;
        const groupedAlbums = groupAlbums(rawItems);
        albumGroups = groupedAlbums;
        console.log(`[runExplore] Loaded ${albumGroups.length} unique albums from ${rawItems.length} tracks for ${start}s`);
        // Skip expensive audio validation - trust FileMaker data
        // primeAlbumAudioValidation(albumGroups);
        currentMode = 'explore';
        currentExploreDecade = start; // Save decade for reload
        if (!albumGroups.length) {
          errorEl.hidden = false;
          errorEl.textContent = `No albums with complete audio and artwork found for the ${start}s.`;
          rawItems = [];
          rawTotalFound = 0;
          refreshPublicPlaylists([]);
          renderAlbumPage();
          return;
        }
        shuffleInPlace(albumGroups);
        rawItems = albumGroups;
        rawTotalFound = albumGroups.length;
        albumPage = 0;
        refreshPublicPlaylists(groupedAlbums);
        renderAlbumPage();
      } finally {
        hideBusy();
        if (restoringThisRun) isRestoring = false;
      }
        }

    // Build decade chips and toggle
    if (exploreDecadesEl){
      const decades = [1950,1960,1970,1980,1990,2000,2010,2020];
      exploreDecadesEl.innerHTML = '';
      for (const d of decades) {
        const b = document.createElement('button');
        b.textContent = d + 's';
        b.addEventListener('click', () => runExplore(d));
        exploreDecadesEl.appendChild(b);
      }
    }

    if (exploreGenresEl){
      const genres = ['Marabi','Maskandi','Kwela','Mbaqanga','Country','Pop','Rock','Afro Rock','Afro Pop'];
      exploreGenresEl.innerHTML = '';
      for (const genre of genres) {
        const btn = document.createElement('button');
        btn.textContent = genre;
        btn.addEventListener('click', () => handleExploreSearch(genre));
        exploreGenresEl.appendChild(btn);
      }
    }

    if (exploreMoodsEl){
      const moods = ['Happy','Romantic','RoadTrip','Sunset'];
      exploreMoodsEl.innerHTML = '';
      for (const mood of moods) {
        const btn = document.createElement('button');
        btn.textContent = mood;
        btn.addEventListener('click', () => handleExploreSearch(mood));
        exploreMoodsEl.appendChild(btn);
      }
    }

    if (exploreEl && explorePanel){
      exploreEl.setAttribute('aria-expanded', explorePanel.hasAttribute('hidden') ? 'false' : 'true');
      exploreEl.addEventListener('click', () => {
        const hidden = explorePanel.hasAttribute('hidden');
        if (hidden) {
          explorePanel.removeAttribute('hidden');
          exploreEl.setAttribute('aria-expanded', 'true');
        } else {
          closeExplorePanel();
        }
      });
    }
    function run(q){
      // Searching: ensure explore layout class is removed
      try {
        const contentCol = document.querySelector('.content-column');
        contentCol && contentCol.classList.remove('exploring');
      } catch {}

      // SEARCH-ONLY VIEW: hide both My Playlists (sidebar) and Featured Playlists
      try {
        if (playlistColumn) playlistColumn.setAttribute('hidden','');
        if (publicFeaturedRow) publicFeaturedRow.setAttribute('hidden','');
      } catch {}

      if(!q){
        showLanding();
        if (isRestoring) isRestoring = false;
        return;
      } // keep everything else untouched; only search when user types
      if (sharedPlaylistActive) {
        clearSharedPlaylistState();
      }
      const restoringThisRun = isRestoring;
      if (!isRestoring) {
        const hasPrevious = albumGroups.length || rawItems.length;
        if (hasPrevious) {
          const previousTerm = lastQ;
          const snapshot = snapshotState({ lastQ: previousTerm, searchValue: previousTerm });
          prevSearch = { type: snapshot.mode || currentMode, term: previousTerm, snapshot };
        } else {
          prevSearch = null;
        }
      }
      lastQ = q;
      albumsEl.classList.remove('single-album');
      hideLanding();
      shouldScrollAlbums = true;
      showBusy('Searching…');
      doSearch(q)
        .then(json => {
          rawItems = json?.items || [];
          rawTotalFound = Number(json?.total || rawItems.length);
          rawNextOffset = Number(json?.offset || 0) + rawItems.length;

          activePublicPlaylist = null;
          currentMode = 'search';
          currentExploreDecade = null; // Clear explore decade when searching
          albumGroups = groupAlbums(rawItems);
          console.log(`[search] Found ${albumGroups.length} unique albums from ${rawItems.length} tracks (query: "${q}")`);
          // Skip audio validation for faster loads
          // primeAlbumAudioValidation(albumGroups);
          refreshPublicPlaylists();
          albumPage = 0;
          renderAlbumPage();
        })
        .catch(err => {
          if (err.name === 'AbortError') return;
          errorEl.hidden = false;
          errorEl.textContent = `Search error: ${err.message || err}`;
        })
        .finally(() => {
          hideBusy();
          if (restoringThisRun) isRestoring = false;
        });
        }

    goEl.addEventListener('click', () => { const q = searchEl.value.trim(); run(q); });
    if (searchEl) {
      searchEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          goEl.click();
        }
      });
        }
    clearEl.addEventListener('click', () => { searchEl.value=''; loadRandomSongs(); });

    if (shuffleBtn) {
      shuffleBtn.addEventListener('click', () => {
        if (currentExploreDecade !== null) {
          // Reload the same decade with different random offset
          runExplore(currentExploreDecade);
        } else if (currentMode === 'songs') {
          // Load more random songs
          loadRandomSongs();
        } else {
          // Load random albums from a different decade
          loadRandomAlbums();
        }
      });
    }

    prevEl.addEventListener('click', () => {
      if (albumPage > 0) {
        albumPage--;
        shouldScrollAlbums = true;
        renderAlbumPage();
      }
    });
    nextEl.addEventListener('click', async () => {
      const maxPage = Math.max(1, Math.ceil((albumGroups.length||0) / ALBUMS_PER_PAGE));
      // If at the last page but FM has more rows, fetch next chunk first
      if (albumPage >= maxPage - 1 && rawItems.length < rawTotalFound) {
        nextEl.disabled = true;
        try { await loadMore(lastQ); } finally { nextEl.disabled = false; }
      }
      const newMax = Math.max(1, Math.ceil((albumGroups.length||0) / ALBUMS_PER_PAGE));
      if (albumPage < newMax - 1) {
        albumPage++;
      }
      shouldScrollAlbums = true;
      renderAlbumPage();
    });

    window.addEventListener('popstate', () => {
      const shareId = getShareIdFromLocation();
      if (shareId) {
        activateSharedPlaylist(shareId, { updateUrl: false });
      } else if (sharedPlaylistActive) {
        clearSharedPlaylistState({ restoreLanding: true });
        loadRandomAlbums();
      }
    });

    // Defer initial load to allow browser to paint UI first
    requestAnimationFrame(() => {
      const initialShareId = getShareIdFromLocation();
      if (initialShareId) {
        activateSharedPlaylist(initialShareId, { updateUrl: false });
      } else {
        loadRandomSongs();
      }
    });
