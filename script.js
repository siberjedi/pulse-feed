(() => {
  const POSTS_KEY = 'pulseFeedPosts.v8';
  const SUGGESTIONS_KEY = 'pulseSuggestions.v2';
  const MUSIC_DB_NAME = 'pulseFeedDb';
  const MUSIC_DB_VERSION = 1;
  const MUSIC_STORE = 'music';
  const MUSIC_KEY = 'tracks';
  const LEGACY_MUSIC_KEY = 'pulseMusicTracks.v1';
  const page = document.body.dataset.page || 'admin';
  const isTimelinePage = page === 'feed' || page === 'mobile';

  const NICKNAMES = ['DerinAkis','BetonZihin','MaskesizGercek','GriDuvar','AltKatSakin','SogukGercek','DipDalga','KaranlikYorum','Gozlemci34','NabizTutan','IsimsizKayit','SistemArizasi','ArkaSokakVeri','KuleAltindan','YedinciKat','UyariSeviyesi','BuzGibiHakikat','SesKaydi01','CatiKatisi','DuvarArasi','user384920','yorumcu_xx','gercekler123','vatandas_01','milliSes78','haberTakipcisi','objektif_bakis','dogruYorumcu','netKonusan','turkEvladidir','sistemSavunucusu','rastgele_987','anon_kayit','yorumMakinesi','feedKontrol','veri_akisi','trendAvcisi','feedTetik','BodrumdanSes','TesisatciDegil','CatiUstunde','DelikIcinden','BetonAltindan','KilerSakin','DuvarKemirgen','SogukZemin','KatMaliki','KiraciDegil','TapuBizde','IslakDuvar','RutubetliGercek','SarsintiOncesi','ArizaKaydi','EnkazAltindan','PasaSakini','YonetimKatinda','MarkaOrtak','GuvenliYarin','BuyumeUzmani','EkonomiTakip','ResmiAciklama','PRMasasi','KrizYonetimi','KamuBilgi','IletisimOfisi','GuvenilirKaynak','KurumsalSes','DestekHatti','StratejiMasasi','DegerYaratir','IleriVizyon','YerAltiKaydi','SertAkis','DissArsivi','MaskeyiDusur','CizgiDisi','SakinOlmam','HukumGeldi','DefterAcik','KayitDisi','GozDiken','NabizYuksek','TansiyonArtis','DuzenCoktu','SinyalYok','VeriPatladi'];

  const state = {
    posts: [], suggestions: [], tracks: [], currentTrackId: '',
    autoScroll: page === 'mobile', speedPxPerSecond: 34, lastTime: performance.now(),
    timelineEvents: [], timelineIndex: 0, lastTrackTime: 0,
    visiblePostIds: [], visibleComments: {}, typingComments: {}, activeCommentFlows: {},
    nickPool: [],
  };

  const ids = ['composerForm','postText','postType','parentPostSelect','mediaFile','carouselFiles','carouselTimestamps','postTimestamp','mediaAspect','authorAvatarFile','authorHandle','authorRandom','isSponsored','isBoosted','feed','adminFeed','manageList','suggestionForm','suggestionHandle','suggestionBio','suggestionAvatarFile','suggestionManageList','suggestionsList','searchInput','autoScrollEnabled','scrollSpeed','pauseAtPosts','musicForm','musicTitle','musicArtist','musicFile','musicManageList','musicTrackSelect','musicToggleBtn','musicPrevBtn','musicNextBtn','musicTrackTitle','musicTrackSinger','musicProgress','musicCurrentTime','musicDuration','musicVisualizer','timelineOverlay','recordToggleBtn','editAvatarInput','editMediaInput'];
  const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const formatText = (text) => esc(text).replace(/(^|\s)(@\+[a-zA-Z0-9_.-]+)/g, '$1<span class="mention-plus">$2</span>');
  const timeAgo = (ts) => `${Math.max(1, Math.floor((Date.now() - ts) / 60000))}m`;
  const fmt = (v) => { const t = Math.floor(v || 0); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  const avatarFor = (h) => `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(String(h || 'user').replace('@', ''))}`;

  const audioPlayer = new Audio();
  audioPlayer.loop = false;
  let musicDbPromise = null;

  const visualizer = {
    ctx: null,
    analyser: null,
    source: null,
    data: null,
    raf: 0,
  };

  function seedSuggestions() {
    return [{ id: uid(), handle: '@blue.artist', bio: 'visual performer', avatar: '' }];
  }

  function allPosts() { return state.posts.filter((x) => x.type === 'post').sort((a, b) => a.createdAt - b.createdAt); }
  function commentsFor(postId) { return state.posts.filter((x) => x.type === 'comment' && x.parentId === postId).sort((a, b) => a.createdAt - b.createdAt); }

  function persistPostAndSuggestions() {
    localStorage.setItem(POSTS_KEY, JSON.stringify(state.posts));
    localStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(state.suggestions));
  }

  function openMusicDb() {
    if (!window.indexedDB) return Promise.resolve(null);
    if (musicDbPromise) return musicDbPromise;
    musicDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(MUSIC_DB_NAME, MUSIC_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(MUSIC_STORE)) db.createObjectStore(MUSIC_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('DB açılamadı'));
    });
    return musicDbPromise;
  }

  async function loadTracks() {
    try {
      const db = await openMusicDb();
      if (!db) throw new Error('no db');
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(MUSIC_STORE, 'readonly');
        const req = tx.objectStore(MUSIC_STORE).get(MUSIC_KEY);
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return JSON.parse(localStorage.getItem(LEGACY_MUSIC_KEY) || '[]') || [];
    }
  }

  async function persistTracks() {
    try {
      const db = await openMusicDb();
      if (!db) throw new Error('no db');
      await new Promise((resolve, reject) => {
        const tx = db.transaction(MUSIC_STORE, 'readwrite');
        tx.objectStore(MUSIC_STORE).put(state.tracks, MUSIC_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      localStorage.removeItem(LEGACY_MUSIC_KEY);
      return true;
    } catch {
      try {
        localStorage.setItem(LEGACY_MUSIC_KEY, JSON.stringify(state.tracks));
        return true;
      } catch {
        alert('Şarkı kaydedilemedi.');
        return false;
      }
    }
  }

  async function loadData() {
    state.posts = JSON.parse(localStorage.getItem(POSTS_KEY) || '[]') || [];
    state.suggestions = JSON.parse(localStorage.getItem(SUGGESTIONS_KEY) || 'null') || seedSuggestions();
    state.tracks = await loadTracks();
    state.currentTrackId = state.tracks[0]?.id || '';
    state.nickPool = [...NICKNAMES];
  }

  function renderParentOptions() {
    if (!el.parentPostSelect) return;
    el.parentPostSelect.innerHTML = '<option value="">None</option>' + allPosts().map((p) => `<option value="${p.id}">${esc(p.author)} · ${esc(p.text.slice(0, 20))}</option>`).join('');
  }

  function mediaNode(item, cls = 'media') {
    if (!item?.src) return '';
    if (item.mediaType === 'video') return `<video class="${cls}" src="${item.src}" muted playsinline controls></video>`;
    return `<img class="${cls}" src="${item.src}" alt="media" />`;
  }

  function getFeedPosts() {
    if (!isTimelinePage) return allPosts();
    return state.visiblePostIds
      .map((id) => state.posts.find((x) => x.id === id && x.type === 'post'))
      .filter(Boolean);
  }

  function renderFeed(target) {
    if (!target) return;
    const postList = getFeedPosts();
    if (!postList.length) {
      target.innerHTML = isTimelinePage
        ? '<div class="empty-feed">Akış müzik zaman damgalarını bekliyor...</div>'
        : '<div class="empty-feed">No posts yet.</div>';
      return;
    }

    const isAdminPreview = target.id === 'adminFeed';

    target.innerHTML = postList.map((p) => {
      const avatar = p.authorAvatar || avatarFor(p.author);
      const allComments = commentsFor(p.id);
      const revealedIds = state.visibleComments[p.id] || [];
      const shownComments = isTimelinePage ? allComments.filter((c) => revealedIds.includes(c.id)) : allComments;
      const typing = isTimelinePage ? state.typingComments[p.id] : null;

      return `<article class="post-card" data-post-id="${p.id}">
        <header class="post-head">
          <img class="avatar ${isAdminPreview ? 'editable-avatar' : ''}" src="${avatar}" alt="${esc(p.author)} avatar" ${isAdminPreview ? `data-edit-avatar="${p.id}"` : ''} />
          <p class="meta-row"><strong>${esc(p.author)}</strong>${p.vip ? ` <span class="vip-badge"><img src="vip-crown.svg" alt="VIP" class="vip-crown" /></span>` : ""} <span class="timestamp">· ${timeAgo(p.createdAt)}</span></p>
        </header>
        <p class="post-text ${isAdminPreview ? 'editable-text' : ''}" ${isAdminPreview ? `data-edit-text="${p.id}"` : ''}>${formatText(p.text)}</p>
        <div ${isAdminPreview ? `data-edit-media="${p.id}" class="editable-media-wrap"` : ''}>${mediaNode({ src: p.media, mediaType: p.mediaType })}</div>
        <div class="post-actions"><span data-like-id="${p.id}">❤ ${p.likes || 0}</span><span data-repost-id="${p.id}">↻ ${p.reposts || 0}</span></div>${isAdminPreview ? `<div class="admin-ts-row"><label>TS <input type="number" step="0.1" min="0" value="${Number.isFinite(p.timestampSec) ? p.timestampSec : ""}" data-edit-post-ts="${p.id}" /></label><button type="button" class="publish-btn" data-save-post-ts="${p.id}">Kaydet</button></div>` : ""}
        ${isAdminPreview ? `<div class="quick-comment-wrap" data-quick-wrap="${p.id}"><button class="publish-btn quick-comment-btn" type="button" data-quick-comment="${p.id}">+ Hızlı yorum</button><form class="quick-comment-form" data-quick-form="${p.id}"><textarea rows="2" placeholder="Yorum metni" data-quick-text="${p.id}"></textarea><input type="number" min="0" step="0.1" placeholder="Zaman damgası (sn)" data-quick-ts="${p.id}" /><div class="quick-comment-actions"><button class="publish-btn" type="submit">Ekle</button><button class="delete-btn" type="button" data-quick-cancel="${p.id}">Kapat</button></div></form></div>` : ''}
        <section class="comments">
          ${shownComments.map((c) => {
            const cAvatar = c.authorAvatar || avatarFor(c.author);
            if (isAdminPreview) {
              return `<div class="comment comment-edit" data-comment-id="${c.id}"><img class="avatar mini editable-comment-avatar" src="${cAvatar}" alt="${esc(c.author)} avatar" data-edit-comment-avatar="${c.id}" /><div class="comment-edit-fields"><input type="text" value="${esc(c.author)}" data-edit-comment-author="${c.id}" /><input type="number" step="0.1" min="0" value="${Number.isFinite(c.timestampSec) ? c.timestampSec : ''}" data-edit-comment-ts="${c.id}" /><textarea rows="2" data-edit-comment-text="${c.id}">${esc(c.text)}</textarea><button type="button" class="publish-btn" data-save-comment="${c.id}">Yorumu Kaydet</button></div></div>`;
            }
            return `<p class="comment" data-comment-id="${c.id}"><img class="avatar mini" src="${cAvatar}" alt="${esc(c.author)} avatar" /><span><strong>${esc(c.author)}</strong>: ${formatText(c.text)}</span></p>`;
          }).join('')}
          ${typing ? `<div class="typing-bubble"><img class="avatar mini" src="${typing.avatar}" alt="typing avatar" /><span><strong>${esc(typing.author)}</strong> yazıyor</span><i></i><i></i><i></i></div>` : ''}
        </section>
      </article>`;
    }).join('');
  }

  function renderManageList() {
    if (!el.manageList) return;
    el.manageList.innerHTML = state.posts.sort((a, b) => b.createdAt - a.createdAt).map((item) => `<div class="manage-item"><div><p><strong>${esc(item.author)}</strong> · ${item.type}</p><small>${esc(item.text.slice(0, 70))}</small></div><button class="delete-btn" data-delete-post-id="${item.id}">Delete</button></div>`).join('');
  }

  function renderSuggestions() {
    if (!el.suggestionsList) return;
    const q = (el.searchInput?.value || '').toLowerCase();
    el.suggestionsList.innerHTML = state.suggestions
      .filter((s) => !q || s.handle.toLowerCase().includes(q) || s.bio.toLowerCase().includes(q))
      .map((s) => `<article class="suggestion-item"><div class="suggestion-head"><img class="avatar mini" src="${s.avatar || avatarFor(s.handle)}" alt="${esc(s.handle)} avatar" /><div class="suggestion-body"><p><strong>${esc(s.handle)}</strong></p><small>${esc(s.bio)}</small></div></div><button type="button" class="follow-btn">Takip Et</button></article>`)
      .join('');
  }

  function renderSuggestionManager() {
    if (!el.suggestionManageList) return;
    el.suggestionManageList.innerHTML = state.suggestions.map((s) => `<div class="manage-item"><div><strong>${esc(s.handle)}</strong><br><small>${esc(s.bio)}</small></div><button class="delete-btn" data-delete-suggestion-id="${s.id}">Delete</button></div>`).join('');
  }

  function renderTrackSelect() {
    if (!el.musicTrackSelect) return;
    el.musicTrackSelect.innerHTML = state.tracks.length
      ? state.tracks.map((t) => `<option value="${t.id}">${esc(t.title)} · ${esc(t.artist)}</option>`).join('')
      : '<option value="">Şarkı yok</option>';
    if (state.currentTrackId) el.musicTrackSelect.value = state.currentTrackId;
  }

  function renderTrackManager() {
    if (!el.musicManageList) return;
    el.musicManageList.innerHTML = state.tracks.map((t) => `<div class="manage-item"><div><strong>${esc(t.title)}</strong><br><small>${esc(t.artist)}</small></div><button class="delete-btn" data-delete-track-id="${t.id}">Delete</button></div>`).join('');
  }

  function refresh() {
    renderParentOptions();
    renderFeed(el.feed);
    renderFeed(el.adminFeed);
    renderManageList();
    renderSuggestions();
    renderSuggestionManager();
    renderTrackSelect();
    renderTrackManager();
  }

  function pickRandomNick() {
    if (!state.nickPool.length) state.nickPool = [...NICKNAMES];
    const i = Math.floor(Math.random() * state.nickPool.length);
    return `@${state.nickPool.splice(i, 1)[0]}`;
  }

  const toDataUrl = (file) => new Promise((resolve, reject) => {
    if (!file) return resolve('');
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  async function onPublish(e) {
    e.preventDefault();
    const text = el.postText.value.trim();
    if (!text) return;

    const type = 'post';
    const parentId = null;

    const mediaFile = el.mediaFile.files?.[0] || null;
    const media = await toDataUrl(mediaFile);
    const mediaType = mediaFile?.type.startsWith('video/') ? 'video' : 'image';
    const avatar = await toDataUrl(el.authorAvatarFile.files?.[0] || null);

    const carouselFiles = Array.from(el.carouselFiles?.files || []);
    const stampList = (el.carouselTimestamps?.value || '').split(',').map((x) => Number(x.trim()));
    const carousel = [];
    for (let i = 0; i < carouselFiles.length; i += 1) {
      const f = carouselFiles[i];
      carousel.push({ src: await toDataUrl(f), mediaType: f.type.startsWith('video/') ? 'video' : 'image', timestampSec: Number.isFinite(stampList[i]) ? stampList[i] : null });
    }

    state.posts.push({
      id: uid(),
      type,
      parentId,
      author: el.authorRandom?.checked ? pickRandomNick() : (el.authorHandle.value.trim() || '@studio.pulse'),
      authorAvatar: avatar,
      text,
      media,
      mediaType,
      carousel,
      timestampSec: Number.isFinite(Number(el.postTimestamp?.value)) ? Number(el.postTimestamp.value) : null,
      sponsored: Boolean(el.isSponsored.checked),
      vip: !el.authorRandom?.checked && Boolean(el.authorHandle.value.trim()),
      boosted: Boolean(el.isBoosted.checked),
      likes: (!el.authorRandom?.checked && Boolean(el.authorHandle.value.trim())) ? Math.floor(22000 + (Math.random() * 56000)) : Math.floor(900 + (Math.random() * 14000)),
      reposts: (!el.authorRandom?.checked && Boolean(el.authorHandle.value.trim())) ? Math.floor(7000 + (Math.random() * 24000)) : Math.floor(140 + (Math.random() * 6200)),
      aspectRatio: (el.mediaAspect?.value || "16/9"),
      createdAt: Date.now(),
    });

    persistPostAndSuggestions();
    buildTimeline();
    refresh();
    el.composerForm.reset();
    if (el.authorRandom) el.authorRandom.checked = true;
    if (el.authorHandle) {
      el.authorHandle.value = '@studio.pulse';
      el.authorHandle.disabled = true;
    }
  }

  async function onAddTrack(e) {
    e.preventDefault();
    const file = el.musicFile.files?.[0] || null;
    const title = el.musicTitle.value.trim();
    const artist = el.musicArtist.value.trim();
    if (!file || !title || !artist) return alert('Şarkı eklemek için tüm alanları doldurun.');

    const track = { id: uid(), title, artist, src: await toDataUrl(file), createdAt: Date.now() };
    state.tracks.unshift(track);
    state.currentTrackId = track.id;
    if (!(await persistTracks())) {
      state.tracks = state.tracks.filter((x) => x.id !== track.id);
      return;
    }
    refresh();
    applyTrack(track.id);
    el.musicForm.reset();
  }

  function applyTrack(id) {
    const t = state.tracks.find((x) => x.id === id);
    if (!t) return;
    state.currentTrackId = id;
    audioPlayer.src = t.src;
    if (el.musicTrackTitle) el.musicTrackTitle.textContent = t.title;
    if (el.musicTrackSinger) el.musicTrackSinger.textContent = t.artist;
  }

  async function ensureVisualizerNodes() {
    if (visualizer.analyser) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!visualizer.ctx) visualizer.ctx = new AudioCtx();
    if (visualizer.ctx.state === 'suspended') await visualizer.ctx.resume();
    visualizer.source = visualizer.ctx.createMediaElementSource(audioPlayer);
    visualizer.analyser = visualizer.ctx.createAnalyser();
    visualizer.analyser.fftSize = 256;
    visualizer.source.connect(visualizer.analyser);
    visualizer.analyser.connect(visualizer.ctx.destination);
    visualizer.data = new Uint8Array(visualizer.analyser.frequencyBinCount);
  }


  function syncMobilePlaybackLayout(isPlaying) {
    if (page !== 'mobile') return;
    document.body.classList.toggle('mobile-playing', Boolean(isPlaying));
    if (isPlaying && el.feed) el.feed.scrollTop = 0;
  }

  async function togglePlayback() {
    if (!audioPlayer.src) applyTrack(el.musicTrackSelect?.value || state.currentTrackId);
    if (!audioPlayer.src) return;

    if (audioPlayer.paused) {
      try {
        await ensureVisualizerNodes();
        if (visualizer.ctx?.state === 'suspended') await visualizer.ctx.resume();
        if (isTimelinePage) {
          const recordingReady = await startRecording(true);
          if (!recordingReady) return;
        }
        await audioPlayer.play();
        syncMobilePlaybackLayout(true);
      } catch {
        alert('Tarayıcı oynatmayı engelledi.');
      }
    } else {
      audioPlayer.pause();
      autoRecordStop();
      syncMobilePlaybackLayout(false);
      el.feed?.style.setProperty('--mobile-comment-reserve', '140px');
    }

    if (el.musicToggleBtn) el.musicToggleBtn.textContent = audioPlayer.paused ? '▶' : '❚❚';
  }

  function rebuildFeedFromTimelineTime(t) {
    state.visiblePostIds = [];
    state.visibleComments = {};
    state.typingComments = {};

    for (const ev of state.timelineEvents) {
      if (ev.ts > t) break;
      if (ev.kind === 'post') {
        if (!state.visiblePostIds.includes(ev.post.id)) state.visiblePostIds.push(ev.post.id);
      }
      if (ev.kind === 'comment') {
        if (!state.visiblePostIds.includes(ev.post.id)) state.visiblePostIds.push(ev.post.id);
        if (!state.visibleComments[ev.post.id]) state.visibleComments[ev.post.id] = [];
        if (!state.visibleComments[ev.post.id].includes(ev.comment.id)) state.visibleComments[ev.post.id].push(ev.comment.id);
      }
    }

    refresh();
  }

  function buildTimeline() {
    const events = [];
    for (const p of allPosts()) {
      if (Number.isFinite(p.timestampSec)) events.push({ ts: p.timestampSec, kind: 'post', post: p });
      for (const c of commentsFor(p.id)) {
        if (Number.isFinite(c.timestampSec)) events.push({ ts: c.timestampSec, kind: 'comment', post: p, comment: c });
      }
      for (const item of (p.carousel || [])) {
        if (Number.isFinite(item.timestampSec)) events.push({ ts: item.timestampSec, kind: 'carousel', post: p, item });
      }
    }
    state.timelineEvents = events.sort((a, b) => a.ts - b.ts);
    state.timelineIndex = 0;
  }

  function centerNodeInFeed(node) {
    if (!isTimelinePage || !el.feed || !node) return;
    if (page === 'mobile') {
      const feedRect = el.feed.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const current = el.feed.scrollTop;
      const delta = (nodeRect.top - feedRect.top) - ((feedRect.height / 2) - (nodeRect.height / 2));
      el.feed.scrollTo({ top: Math.max(0, current + delta), behavior: 'auto' });
      return;
    }
    const rect = node.getBoundingClientRect();
    const delta = rect.top - ((window.innerHeight / 2) - (rect.height / 2));
    window.scrollBy({ top: delta, behavior: 'smooth' });
  }

  function centerPost(postId) {
    if (!isTimelinePage || !el.feed) return;
    centerNodeInFeed(el.feed.querySelector(`[data-post-id="${postId}"]`));
  }

  function centerComment(postId, commentId) {
    if (!isTimelinePage || !el.feed || !commentId) return;
    const postNode = el.feed.querySelector(`[data-post-id="${postId}"]`);
    const commentNode = postNode?.querySelector(`[data-comment-id="${commentId}"]`);
    if (!commentNode) {
      centerNodeInFeed(postNode);
      return;
    }

    if (page === 'mobile') {
      const feedRect = el.feed.getBoundingClientRect();
      const current = el.feed.scrollTop;
      const commentNodes = Array.from(postNode?.querySelectorAll('.comment') || []);
      const sampleNodes = commentNodes.slice(-3);
      const sampleAvgHeight = sampleNodes.length
        ? (sampleNodes.reduce((sum, n) => sum + n.getBoundingClientRect().height, 0) / sampleNodes.length)
        : commentNode.getBoundingClientRect().height;
      const reserveBelow = Math.max(sampleAvgHeight * 2, 120);
      el.feed.style.setProperty('--mobile-comment-reserve', `${Math.round(reserveBelow)}px`);
      const safeBottom = feedRect.bottom - reserveBelow;

      const commentsWrap = postNode?.querySelector('.comments');
      const tailNode = commentsWrap?.lastElementChild || commentNode;
      const tailRect = tailNode.getBoundingClientRect();
      const targetScroll = current + (tailRect.bottom - safeBottom);
      const maxScroll = Math.max(0, el.feed.scrollHeight - el.feed.clientHeight);
      el.feed.scrollTo({ top: Math.max(0, Math.min(maxScroll, targetScroll)), behavior: 'auto' });
      return;
    }

    centerNodeInFeed(commentNode);
  }

  let overlayTimer = 0;
  let boostTimer = 0;

  function nextPostTsAfter(ts) {
    const ev = state.timelineEvents.find((x) => x.kind === "post" && x.ts > ts);
    return ev ? ev.ts : null;
  }

  function hideOverlay() {
    if (!el.timelineOverlay) return;
    clearTimeout(overlayTimer);
    el.timelineOverlay.innerHTML = '';
    el.timelineOverlay.classList.remove('active');
  }

  function showOverlay(html, { sticky = false, duration = 1300 } = {}) {
    if (!isTimelinePage || !el.timelineOverlay) return;
    clearTimeout(overlayTimer);
    clearInterval(boostTimer);
    el.timelineOverlay.classList.add('active');
    el.timelineOverlay.innerHTML = `<div class="timeline-modal"><button class="overlay-close" type="button" data-close-overlay="1">✕</button>${html}</div>`;
    const commentsNode = el.timelineOverlay.querySelector('.popup-comments');
    if (commentsNode) commentsNode.scrollTop = commentsNode.scrollHeight;
    const video = el.timelineOverlay.querySelector('[data-auto-close-video]');
    if (video) {
      video.addEventListener('ended', () => {
        hideOverlay();
      }, { once: true });
    }
    const modal = el.timelineOverlay.querySelector('.timeline-modal');
    if (modal) {
      modal.addEventListener('wheel', (ev) => {
        ev.stopPropagation();
      }, { passive: true });
    }
    if (!sticky) {
      overlayTimer = window.setTimeout(() => {
        hideOverlay();
      }, duration);
    }
  }

  function nextTimedComment(post, currentTs) {
    return commentsFor(post.id)
      .filter((c) => Number.isFinite(c.timestampSec) && c.timestampSec > currentTs)
      .sort((a, b) => a.timestampSec - b.timestampSec)[0] || null;
  }


  function popupHtmlForPost(post) {
    const comments = commentsFor(post.id).filter((c) => (state.visibleComments[post.id] || []).includes(c.id));
    const typing = state.typingComments[post.id];
    const mainMedia = post.mediaType === 'video'
      ? (post.media ? `<video class="timeline-media" src="${post.media}" autoplay muted playsinline controls data-auto-close-video="1"></video>` : '')
      : (post.media ? `<div class="popup-media-box">${mediaNode({ src: post.media, mediaType: post.mediaType }, 'timeline-media')}</div>` : '');
    const carousel = (post.carousel || []).length
      ? `<div class="popup-carousel-track">${post.carousel.map((it) => `<div class="popup-carousel-item">${mediaNode(it, 'timeline-media')}</div>`).join('')}</div>`
      : '';
    const commentsHtml = `<div class="popup-comments">${comments.map((c) => `<p class="comment"><img class="avatar mini" src="${c.authorAvatar || avatarFor(c.author)}" alt="${esc(c.author)} avatar" /><span><strong>${esc(c.author)}</strong>: ${formatText(c.text)}</span></p>`).join('')}${typing ? `<div class="typing-bubble"><img class="avatar mini" src="${typing.avatar}" alt="typing avatar" /><span><strong>${esc(typing.author)}</strong> yazıyor</span><i></i><i></i><i></i></div>` : ''}</div>`;
    return `<div class="popup-post"><h3>${esc(post.author)}</h3><p>${formatText(post.text)}</p>${mainMedia}${carousel}${commentsHtml}</div>`;
  }

  function triggerEvent(ev, nextTs) {
    void nextTs;
    hideOverlay();
    state.popupPostId = null;

    if (ev.kind === 'post') {
      if (!state.visiblePostIds.includes(ev.post.id)) state.visiblePostIds.push(ev.post.id);
      refresh();
      centerPost(ev.post.id);

      if (ev.post.boosted) {
        if (!state.activeBoostIds) state.activeBoostIds = [];
        if (!state.activeBoostCfg) state.activeBoostCfg = {};
        if (!state.activeBoostIds.includes(ev.post.id)) state.activeBoostIds.push(ev.post.id);
        state.activeBoostCfg[ev.post.id] = {
          endAt: ev.ts + 4.5,
          stopAtNextPostTs: nextPostTsAfter(ev.ts),
        };
      }
      return;
    }

    if (ev.kind === 'comment') {
      if (!state.visiblePostIds.includes(ev.post.id)) state.visiblePostIds.push(ev.post.id);
      if (!state.visibleComments[ev.post.id]) state.visibleComments[ev.post.id] = [];
      if (!state.visibleComments[ev.post.id].includes(ev.comment.id)) state.visibleComments[ev.post.id].push(ev.comment.id);

      const nextComment = nextTimedComment(ev.post, ev.ts);
      if (nextComment) {
        state.typingComments[ev.post.id] = {
          author: nextComment.author,
          avatar: nextComment.authorAvatar || avatarFor(nextComment.author),
        };
      } else {
        delete state.typingComments[ev.post.id];
      }

      refresh();
      centerComment(ev.post.id, ev.comment.id);
      return;
    }

    if (ev.kind === 'carousel') {
      if (!state.visiblePostIds.includes(ev.post.id)) state.visiblePostIds.push(ev.post.id);
      refresh();
      centerPost(ev.post.id);
    }
  }

  function processTimeline() {
    if (!isTimelinePage || audioPlayer.paused) return;
    const t = audioPlayer.currentTime;

    if (t + 0.3 < state.lastTrackTime) {
      rebuildFeedFromTimelineTime(t);
      state.timelineIndex = state.timelineEvents.findIndex((x) => x.ts > t - 0.01);
      if (state.timelineIndex < 0) state.timelineIndex = state.timelineEvents.length;
    }

    while (state.timelineIndex < state.timelineEvents.length && state.timelineEvents[state.timelineIndex].ts <= t + 0.05) {
      const ev = state.timelineEvents[state.timelineIndex];
      const nextTs = state.timelineEvents[state.timelineIndex + 1]?.ts;
      triggerEvent(ev, nextTs);
      state.timelineIndex += 1;
    }

    state.lastTrackTime = t;
  }

  let recorder = null;
  let recordStream = null;
  let recordOutputStream = null;
  let recordPreviewVideo = null;
  let recordCanvas = null;
  let recordRaf = 0;
  let recordClickStopArmed = false;
  let recordedChunks = [];

  function stopRecordPipeline() {
    if (recordRaf) cancelAnimationFrame(recordRaf);
    recordRaf = 0;
    if (recordPreviewVideo) {
      recordPreviewVideo.pause();
      recordPreviewVideo.srcObject = null;
      recordPreviewVideo.remove();
      recordPreviewVideo = null;
    }
    recordOutputStream?.getTracks().forEach((tr) => tr.stop());
    recordOutputStream = null;
    recordCanvas = null;
  }

  async function buildCentered4kStream() {
    const source = recordStream;
    if (!source) return null;

    recordPreviewVideo = document.createElement('video');
    recordPreviewVideo.muted = true;
    recordPreviewVideo.playsInline = true;
    recordPreviewVideo.srcObject = source;
    await recordPreviewVideo.play();

    recordCanvas = document.createElement('canvas');
    recordCanvas.width = 2160;
    recordCanvas.height = 3840;
    const ctx = recordCanvas.getContext('2d');
    if (!ctx) return null;

    const drawFrame = () => {
      const srcW = recordPreviewVideo.videoWidth || 1;
      const srcH = recordPreviewVideo.videoHeight || 1;
      const targetRect = (page === 'mobile' ? document.getElementById('mobileCaptureRegion') : el.feed)?.getBoundingClientRect();
      const viewportW = window.innerWidth || 1;
      const viewportH = window.innerHeight || 1;
      const sxScale = srcW / viewportW;
      const syScale = srcH / viewportH;

      let sx = 0;
      let sy = 0;
      let sw = srcW;
      let sh = srcH;

      if (targetRect && targetRect.width > 1 && targetRect.height > 1) {
        sx = Math.max(0, targetRect.left * sxScale);
        sy = Math.max(0, targetRect.top * syScale);
        sw = Math.min(srcW - sx, Math.max(1, targetRect.width * sxScale));
        sh = Math.min(srcH - sy, Math.max(1, targetRect.height * syScale));
      }

      ctx.clearRect(0, 0, 2160, 3840);
      ctx.drawImage(recordPreviewVideo, sx, sy, sw, sh, 0, 0, 2160, 3840);
      recordRaf = requestAnimationFrame(drawFrame);
    };

    drawFrame();
    return recordCanvas.captureStream(60);
  }

  async function startRecording(silentFail = false) {
    if (!isTimelinePage) return false;
    if (recorder) return true;
    try {
      recordStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: 60,
          width: { ideal: 2160 },
          height: { ideal: 3840 },
          displaySurface: 'browser',
        },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        monitorTypeSurfaces: 'exclude',
      });
      recordOutputStream = await buildCentered4kStream();
      recorder = new MediaRecorder(recordOutputStream || recordStream, { mimeType: 'video/webm;codecs=vp9' });
      recordedChunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `pulse-feed-${Date.now()}.webm`;
        a.click();
        stopRecordPipeline();
        recordStream?.getTracks().forEach((tr) => tr.stop());
        recordStream = null;
        recorder = null;
        recordClickStopArmed = false;
        if (el.recordToggleBtn) el.recordToggleBtn.textContent = '● Record';
      };
      recorder.start(250);
      recordClickStopArmed = false;
      window.setTimeout(() => { recordClickStopArmed = true; }, 450);
      if (el.recordToggleBtn) el.recordToggleBtn.textContent = '■ Stop';
      return true;
    } catch {
      stopRecordPipeline();
      recordStream?.getTracks().forEach((tr) => tr.stop());
      recordStream = null;
      if (!silentFail) alert('Kayıt başlatılamadı. Tarayıcı güvenlik nedeniyle seçim ister.');
      return false;
    }
  }

  function stopRecording() {
    recordClickStopArmed = false;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  const autoRecordStart = async () => { await startRecording(true); };
  const autoRecordStop = () => { stopRecording(); };

  function bind() {
    if (el.authorRandom) {
      el.authorHandle.disabled = el.authorRandom.checked;
      el.authorRandom.addEventListener('change', () => {
        el.authorHandle.disabled = el.authorRandom.checked;
      });
    }

    if (el.composerForm) el.composerForm.addEventListener('submit', onPublish);

    if (el.manageList) {
      el.manageList.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-delete-post-id]');
        if (!btn) return;
        const id = btn.dataset.deletePostId;
        state.posts = state.posts.filter((x) => x.id !== id && x.parentId !== id);
        persistPostAndSuggestions();
        buildTimeline();
        refresh();
      });
    }

    if (el.suggestionForm) {
      el.suggestionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const handle = el.suggestionHandle.value.trim();
        const bio = el.suggestionBio.value.trim();
        if (!handle || !bio) return;
        state.suggestions.unshift({
          id: uid(),
          handle: handle.startsWith('@') ? handle : `@${handle}`,
          bio,
          avatar: await toDataUrl(el.suggestionAvatarFile.files?.[0] || null),
        });
        persistPostAndSuggestions();
        refresh();
        el.suggestionForm.reset();
      });
    }

    if (el.suggestionManageList) {
      el.suggestionManageList.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-delete-suggestion-id]');
        if (!btn) return;
        state.suggestions = state.suggestions.filter((x) => x.id !== btn.dataset.deleteSuggestionId);
        persistPostAndSuggestions();
        refresh();
      });
    }


    if (el.adminFeed) {
      el.adminFeed.addEventListener('click', (e) => {
        const avatarBtn = e.target.closest('[data-edit-avatar]');
        if (avatarBtn && el.editAvatarInput) {
          el.editAvatarInput.dataset.postId = avatarBtn.dataset.editAvatar;
          el.editAvatarInput.click();
          return;
        }

        const textBtn = e.target.closest('[data-edit-text]');
        if (textBtn) {
          const id = textBtn.dataset.editText;
          const post = state.posts.find((x) => x.id === id && x.type === 'post');
          if (!post) return;
          const next = window.prompt('Post metnini düzenle:', post.text);
          if (typeof next === 'string' && next.trim()) {
            post.text = next.trim();
            persistPostAndSuggestions();
            buildTimeline();
            refresh();
          }
          return;
        }

        const mediaBtn = e.target.closest('[data-edit-media]');
        if (mediaBtn && el.editMediaInput) {
          el.editMediaInput.dataset.postId = mediaBtn.dataset.editMedia;
          el.editMediaInput.click();
          return;
        }


        const savePostTs = e.target.closest('[data-save-post-ts]');
        if (savePostTs) {
          const id = savePostTs.dataset.savePostTs;
          const post = state.posts.find((x) => x.id === id && x.type === 'post');
          const input = el.adminFeed.querySelector(`[data-edit-post-ts="${id}"]`);
          if (post && input) {
            const val = Number(input.value);
            post.timestampSec = Number.isFinite(val) ? val : null;
            persistPostAndSuggestions();
            buildTimeline();
            refresh();
          }
          return;
        }

        const saveComment = e.target.closest('[data-save-comment]');
        if (saveComment) {
          const id = saveComment.dataset.saveComment;
          const comment = state.posts.find((x) => x.id === id && x.type === 'comment');
          if (!comment) return;
          const authorInput = el.adminFeed.querySelector(`[data-edit-comment-author="${id}"]`);
          const tsInput = el.adminFeed.querySelector(`[data-edit-comment-ts="${id}"]`);
          const textInput = el.adminFeed.querySelector(`[data-edit-comment-text="${id}"]`);
          comment.author = (authorInput?.value || comment.author).trim() || comment.author;
          const tsVal = Number(tsInput?.value);
          comment.timestampSec = Number.isFinite(tsVal) ? tsVal : null;
          comment.text = (textInput?.value || comment.text).trim() || comment.text;
          persistPostAndSuggestions();
          buildTimeline();
          refresh();
          return;
        }

        const editCommentAvatar = e.target.closest('[data-edit-comment-avatar]');
        if (editCommentAvatar && el.editAvatarInput) {
          el.editAvatarInput.dataset.commentId = editCommentAvatar.dataset.editCommentAvatar;
          el.editAvatarInput.dataset.postId = '';
          el.editAvatarInput.click();
          return;
        }
        const quick = e.target.closest('[data-quick-comment]');
        if (quick) {
          const wrap = el.adminFeed.querySelector(`[data-quick-wrap="${quick.dataset.quickComment}"]`);
          if (!wrap) return;
          wrap.classList.add('open');
          const textInput = wrap.querySelector(`[data-quick-text="${quick.dataset.quickComment}"]`);
          if (textInput) textInput.focus();
          return;
        }

        const cancel = e.target.closest('[data-quick-cancel]');
        if (cancel) {
          const wrap = el.adminFeed.querySelector(`[data-quick-wrap="${cancel.dataset.quickCancel}"]`);
          if (wrap) wrap.classList.remove('open');
        }
      });

      el.adminFeed.addEventListener('submit', (e) => {
        const form = e.target.closest('[data-quick-form]');
        if (!form) return;
        e.preventDefault();
        const parentId = form.dataset.quickForm;
        const parent = state.posts.find((x) => x.id === parentId && x.type === 'post');
        if (!parent) return;
        const textInput = form.querySelector(`[data-quick-text="${parentId}"]`);
        const tsInput = form.querySelector(`[data-quick-ts="${parentId}"]`);
        const text = (textInput?.value || '').trim();
        if (!text) return;
        const timestampRaw = Number(tsInput?.value);
        const fallbackTs = Number.isFinite(parent.timestampSec) ? parent.timestampSec + 0.6 + (commentsFor(parentId).length * 0.8) : null;
        state.posts.push({
          id: uid(),
          type: 'comment',
          parentId,
          author: pickRandomNick(),
          authorAvatar: '',
          text,
          media: '',
          mediaType: 'image',
          carousel: [],
          timestampSec: Number.isFinite(timestampRaw) ? timestampRaw : fallbackTs,
          sponsored: false,
          vip: false,
          boosted: false,
          likes: 0,
          reposts: 0,
          createdAt: Date.now(),
        });
        if (textInput) textInput.value = '';
        if (tsInput) tsInput.value = '';
        const wrap = el.adminFeed.querySelector(`[data-quick-wrap="${parentId}"]`);
        if (wrap) wrap.classList.remove('open');
        persistPostAndSuggestions();
        buildTimeline();
        refresh();
      });

      if (el.editAvatarInput) {
        el.editAvatarInput.addEventListener('change', async () => {
          const postId = el.editAvatarInput.dataset.postId;
          const commentId = el.editAvatarInput.dataset.commentId;
          const file = el.editAvatarInput.files?.[0] || null;
          if (!file) return;
          if (commentId) {
            const comment = state.posts.find((x) => x.id === commentId && x.type === 'comment');
            if (comment) comment.authorAvatar = await toDataUrl(file);
          } else if (postId) {
            const post = state.posts.find((x) => x.id === postId && x.type === 'post');
            if (post) post.authorAvatar = await toDataUrl(file);
          }
          persistPostAndSuggestions();
          refresh();
          el.editAvatarInput.value = '';
          el.editAvatarInput.dataset.commentId = '';
        });
      }

      if (el.editMediaInput) {
        el.editMediaInput.addEventListener('change', async () => {
          const id = el.editMediaInput.dataset.postId;
          const post = state.posts.find((x) => x.id === id && x.type === 'post');
          const file = el.editMediaInput.files?.[0] || null;
          if (!post || !file) return;
          post.media = await toDataUrl(file);
          post.mediaType = file.type.startsWith('video/') ? 'video' : 'image';
          persistPostAndSuggestions();
          buildTimeline();
          refresh();
          el.editMediaInput.value = '';
        });
      }
    }

    if (el.musicForm) el.musicForm.addEventListener('submit', (e) => { void onAddTrack(e); });

    if (el.musicManageList) {
      el.musicManageList.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-delete-track-id]');
        if (!btn) return;
        const id = btn.dataset.deleteTrackId;
        state.tracks = state.tracks.filter((x) => x.id !== id);
        if (state.currentTrackId === id) {
          state.currentTrackId = state.tracks[0]?.id || '';
          if (state.currentTrackId) applyTrack(state.currentTrackId);
          else {
            audioPlayer.pause();
            audioPlayer.removeAttribute('src');
          }
        }
        void persistTracks();
        refresh();
      });
    }

    if (el.musicTrackSelect) el.musicTrackSelect.addEventListener('change', () => applyTrack(el.musicTrackSelect.value));
    if (el.musicToggleBtn) el.musicToggleBtn.addEventListener('click', () => { void togglePlayback(); });

    if (el.musicPrevBtn) {
      el.musicPrevBtn.addEventListener('click', () => {
        if (!state.tracks.length) return;
        const i = state.tracks.findIndex((x) => x.id === state.currentTrackId);
        applyTrack(state.tracks[(i - 1 + state.tracks.length) % state.tracks.length].id);
      });
    }

    if (el.musicNextBtn) {
      el.musicNextBtn.addEventListener('click', () => {
        if (!state.tracks.length) return;
        const i = state.tracks.findIndex((x) => x.id === state.currentTrackId);
        applyTrack(state.tracks[(i + 1) % state.tracks.length].id);
      });
    }

    if (el.musicProgress) {
      el.musicProgress.addEventListener('input', () => {
        if (!audioPlayer.duration) return;
        audioPlayer.currentTime = (Number(el.musicProgress.value) / 100) * audioPlayer.duration;
        processTimeline();
      });
    }

    if (el.recordToggleBtn) {
      el.recordToggleBtn.addEventListener('click', () => {
        if (recorder) stopRecording(); else void startRecording();
      });
    }

    if (page === 'mobile') {
      const stopOnTap = (e) => {
        if (!recordClickStopArmed || !recorder) return;
        const region = document.getElementById('mobileCaptureRegion');
        if (!region || !region.contains(e.target)) return;
        stopRecording();
      };
      document.addEventListener('click', stopOnTap);
      document.addEventListener('keydown', (e) => {
        if (!recorder || e.repeat) return;
        if (e.code === 'KeyK' || e.code === 'Escape') stopRecording();
      });
    }

    document.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-close-overlay]');
      if (!closeBtn) return;
      hideOverlay();
      state.popupPostId = null;
    });

    if (el.searchInput) el.searchInput.addEventListener('input', renderSuggestions);
    if (el.autoScrollEnabled) el.autoScrollEnabled.addEventListener('change', () => { state.autoScroll = el.autoScrollEnabled.checked; });
    if (el.scrollSpeed) el.scrollSpeed.addEventListener('input', () => { state.speedPxPerSecond = Number(el.scrollSpeed.value); });
  }

  function tick(now) {
    if (isTimelinePage) {
      if (state.autoScroll && page !== 'mobile') {
        const delta = (now - state.lastTime) / 1000;
        window.scrollBy(0, state.speedPxPerSecond * delta);
      }
      if (!state.lastBoostAt) state.lastBoostAt = now;
      if (now - state.lastBoostAt > 650) {
        const active = state.activeBoostIds || [];
        if (active.length) {
          let changed = false;
          const nowTs = audioPlayer.currentTime || 0;
          state.activeBoostIds = active.filter((id) => {
            const cfg = state.activeBoostCfg?.[id] || null;
            if (cfg) {
              if (nowTs >= cfg.endAt) return false;
              if (Number.isFinite(cfg.stopAtNextPostTs) && nowTs >= cfg.stopAtNextPostTs) return false;
            }
            if (!state.visiblePostIds.includes(id)) return true;
            const post = state.posts.find((x) => x.id === id && x.type === 'post');
            if (!post) return false;
            post.likes += Math.floor(25 + (Math.random() * 90));
            post.reposts += Math.floor(8 + (Math.random() * 35));
            changed = true;
            return true;
          });
          if (changed) renderFeed(el.feed);
        }
        state.lastBoostAt = now;
      }
    }
    state.lastTime = now;
    requestAnimationFrame(tick);
  }

  function initVisualizer() {
    const canvas = el.musicVisualizer;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const w = canvas.width = Math.max(1, canvas.clientWidth);
      const h = canvas.height = Math.max(1, canvas.clientHeight);
      ctx.fillStyle = '#0a0e17';
      ctx.fillRect(0, 0, w, h);

      const bars = 18;
      const gap = 5;
      const barW = Math.max(4, Math.floor((w - ((bars - 1) * gap)) / bars));
      const totalW = (bars * barW) + ((bars - 1) * gap);
      const startX = Math.max(0, (w - totalW) / 2);
      const center = (bars - 1) / 2;

      if (visualizer.analyser && visualizer.data) {
        visualizer.analyser.getByteFrequencyData(visualizer.data);
      }

      for (let i = 0; i < bars; i += 1) {
        const dist = Math.abs(i - center) / center;
        const centerBoost = 1 - (dist ** 1.4);
        const dataIndex = Math.floor((i / bars) * (visualizer.data?.length || 1));
        const rhythm = visualizer.data ? (visualizer.data[dataIndex] / 255) : 0;
        const base = audioPlayer.paused ? 0.06 : 0.12;
        const level = Math.max(base, (rhythm * 0.9) + (centerBoost * 0.35));
        const hh = Math.max(6, level * h * (0.15 + (centerBoost * 0.5)));
        const x = startX + (i * (barW + gap));
        const y = (h / 2) - (hh / 2);
        const grad = ctx.createLinearGradient(0, y, 0, y + hh);
        grad.addColorStop(0, '#9cb6ff');
        grad.addColorStop(1, '#41527e');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW, hh);
      }

      visualizer.raf = requestAnimationFrame(draw);
    };

    draw();
  }

  function initAudio() {
    audioPlayer.addEventListener('timeupdate', () => {
      if (el.musicCurrentTime) el.musicCurrentTime.textContent = fmt(audioPlayer.currentTime);
      if (el.musicDuration) el.musicDuration.textContent = fmt(audioPlayer.duration);
      if (el.musicProgress && audioPlayer.duration) {
        el.musicProgress.value = String((audioPlayer.currentTime / audioPlayer.duration) * 100);
      }
      processTimeline();
    });

    audioPlayer.addEventListener('ended', () => {
      if (el.musicToggleBtn) el.musicToggleBtn.textContent = '▶';
      autoRecordStop();
      syncMobilePlaybackLayout(false);
      hideOverlay();
    });

    audioPlayer.addEventListener('pause', () => {
      syncMobilePlaybackLayout(false);
    });
  }

  async function init() {
    await loadData();
    buildTimeline();
    refresh();
    bind();
    initVisualizer();
    initAudio();
    if (page === 'mobile') {
      state.autoScroll = true;
      syncMobilePlaybackLayout(false);
    }
    if (state.currentTrackId) applyTrack(state.currentTrackId);
    requestAnimationFrame(tick);
  }

  void init();
})();
