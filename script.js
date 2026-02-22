(() => {
  const STORAGE_KEY = 'pulse.lyricVideoConfig.v2';
  const ASSET_DB = 'pulseLyricAssets';
  const ASSET_STORE = 'files';

  const EFFECTS = [
    ['effect-fade', 'Fade In / Fade Out'],
    ['effect-slide-up', 'Slide Up'],
    ['effect-slide-left', 'Slide From Left'],
    ['effect-blur', 'Blur’dan Netleşme'],
    ['effect-opacity-pulse', 'Opacity Pulse'],
    ['effect-glitch', 'Glitch Effect'],
    ['effect-shake', 'Shake / Impact'],
    ['effect-letter-stagger', 'Letter Stagger'],
    ['effect-distortion-flash', 'Distortion Flash'],
    ['effect-typewriter', 'Typewriter Effect'],
    ['effect-mask-reveal', 'Mask Reveal'],
    ['effect-scale-impact', 'Scale Impact'],
    ['effect-word-highlighting', 'Word Highlighting'],
    ['effect-audio-reactive', 'Audio Reactive Text'],
    ['effect-3d-perspective', '3D Perspective Text'],
    ['effect-particle-text', 'Particle Text'],
  ];

  const defaultConfig = {
    song: {
      title: '',
      fileName: '',
      size: 0,
      mimeType: '',
      assetKey: '',
      objectUrl: '',
      showPlayer: true,
      visualizerWithSong: false,
    },
    visualizer: { enabled: false, type: 'bar', color: '#5f87ff' },
    background: { mode: 'loop', color: '#040812', items: [] },
    recording: { fps: 60, bitrateMbps: 80 },
    lyricLayout: { desktopScale: 12, mobileScale: 12, mobileFullWidth: false },
    lyrics: [],
    fonts: [],
  };

  const page = document.body.dataset.page;
  const state = {
    config: loadConfig(),
    audioCtx: null,
    analyser: null,
    audioData: new Uint8Array(256),
    activeLyricId: null,
    visualizerRaf: 0,
    mediaRecorder: null,
    chunks: [],
    stream: null,
    stopOnTapHandler: null,
    isRecording: false,
    recordTarget: null,
    downloadUrl: '',
    recordMime: 'video/webm',
  };

  function uid() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function loadConfig() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw) return structuredClone(defaultConfig);
      return {
        ...structuredClone(defaultConfig),
        ...raw,
        song: { ...defaultConfig.song, ...(raw.song || {}) },
        visualizer: { ...defaultConfig.visualizer, ...(raw.visualizer || {}) },
        background: {
          ...defaultConfig.background,
          ...(raw.background || {}),
          items: Array.isArray(raw.background?.items) ? raw.background.items : [],
        },
        recording: { ...defaultConfig.recording, ...(raw.recording || {}) },
        lyricLayout: { ...defaultConfig.lyricLayout, ...(raw.lyricLayout || {}) },
        lyrics: Array.isArray(raw.lyrics) ? raw.lyrics : [],
        fonts: Array.isArray(raw.fonts) ? raw.fonts : [],
      };
    } catch {
      return structuredClone(defaultConfig);
    }
  }

  function persistableConfig() {
    const clone = structuredClone(state.config);
    if (clone.song) clone.song.objectUrl = '';
    clone.background.items = clone.background.items.map((x) => ({ ...x, objectUrl: '' }));
    clone.fonts = clone.fonts.map((x) => ({ ...x, objectUrl: '' }));
    return clone;
  }

  function saveConfig() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistableConfig()));
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 KB';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i += 1;
    }
    return `${value.toFixed(1)} ${units[i]}`;
  }

  function timeLabel(s) {
    if (!Number.isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function normalizeToken(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9ığüşöçİĞÜŞÖÇ]+/gi, '');
  }

  function resolveEffectToken(token) {
    const raw = String(token || '').trim();
    if (!raw) return 'effect-fade';
    const direct = EFFECTS.find(([value]) => value === raw);
    if (direct) return direct[0];

    const normalized = normalizeToken(raw);
    const byLabel = EFFECTS.find(([value, label]) => normalizeToken(label) === normalized || normalizeToken(value) === normalized);
    return byLabel ? byLabel[0] : 'effect-fade';
  }

  function resolveFontIdToken(token) {
    const raw = String(token || '').trim();
    if (!raw) return '';
    const exact = state.config.fonts.find((font) => font.id === raw || font.name === raw || font.family === raw);
    if (exact) return exact.id;
    const normalized = normalizeToken(raw);
    const matched = state.config.fonts.find((font) => (
      normalizeToken(font.id) === normalized
      || normalizeToken(font.name) === normalized
      || normalizeToken(font.family) === normalized
    ));
    return matched ? matched.id : '';
  }

  function resolveLyricFontHints() {
    state.config.lyrics = state.config.lyrics.map((line) => {
      if (line.fontId) return line;
      const resolved = resolveFontIdToken(line.fontHint);
      if (!resolved) return line;
      return { ...line, fontId: resolved };
    });
  }

  function resolveColorToken(value, fallback) {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
    return fallback;
  }

  function resolveOutlineWidthToken(value, fallback = 3) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(32, n));
  }

  function parseLyrics(raw) {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [start, end, text = '', font = '', effect = '', typeColor = '', typeOutlineColor = '', typeOutlineThickness = ''] = line.split('|');
        const startNum = Number(start);
        const endNum = Number(end);
        const cleanText = text.trim();
        if (!Number.isFinite(startNum) || !Number.isFinite(endNum) || !cleanText) return null;
        return {
          id: uid(),
          start: startNum,
          end: endNum,
          text: cleanText,
          effect: resolveEffectToken(effect),
          fontId: resolveFontIdToken(font),
          fontHint: String(font || '').trim(),
          textColor: resolveColorToken(typeColor, '#ffffff'),
          outlineColor: resolveColorToken(typeOutlineColor, '#000000'),
          outlineWidth: resolveOutlineWidthToken(typeOutlineThickness, 3),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.start - b.start);
  }

  function effectOptions(selected) {
    return EFFECTS.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
  }

  function fontOptions(selected, includeEmpty = true, includeRandom = false) {
    const opts = includeEmpty ? ['<option value="">Varsayılan</option>'] : [];
    if (includeRandom) opts.push('<option value="__random__">Random</option>');
    for (const font of state.config.fonts) {
      opts.push(`<option value="${font.id}" ${selected === font.id ? 'selected' : ''}>${font.name}</option>`);
    }
    return opts.join('');
  }

  function effectOptionsWithRandom(selected) {
    return `<option value="">Seçin</option><option value="__random__" ${selected === '__random__' ? 'selected' : ''}>Random</option>${effectOptions(selected)}`;
  }

  function pickRandomStableByText(items, valuePicker) {
    const byText = new Map();
    return items.map((item) => {
      const key = item.text.trim().toLowerCase();
      if (!byText.has(key)) byText.set(key, valuePicker());
      return byText.get(key);
    });
  }

  function openAssetDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(ASSET_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function assetPut(key, blob) {
    const db = await openAssetDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE, 'readwrite');
      tx.objectStore(ASSET_STORE).put(blob, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  async function assetGet(key) {
    const db = await openAssetDB();
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE, 'readonly');
      const req = tx.objectStore(ASSET_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  }

  async function assetDelete(key) {
    if (!key) return;
    const db = await openAssetDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE, 'readwrite');
      tx.objectStore(ASSET_STORE).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  function revokeObjectUrl(url) {
    if (!url) return;
    URL.revokeObjectURL(url);
  }

  async function hydrateAssetUrls() {
    if (state.config.song.assetKey) {
      const blob = await assetGet(state.config.song.assetKey);
      state.config.song.objectUrl = blob ? URL.createObjectURL(blob) : '';
    }

    for (const item of state.config.background.items) {
      if (!item.assetKey) continue;
      const blob = await assetGet(item.assetKey);
      item.objectUrl = blob ? URL.createObjectURL(blob) : '';
    }

    for (const font of state.config.fonts) {
      if (!font.assetKey) continue;
      const blob = await assetGet(font.assetKey);
      font.objectUrl = blob ? URL.createObjectURL(blob) : '';
    }
  }

  function mountFontFaces() {
    let styleEl = document.getElementById('dynamicFontFaces');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'dynamicFontFaces';
      document.head.appendChild(styleEl);
    }

    styleEl.textContent = state.config.fonts
      .filter((font) => font.objectUrl)
      .map((font) => `@font-face { font-family: '${font.family}'; src: url('${font.objectUrl}'); font-display: swap; }`)
      .join('\n');
  }

  function bindAdmin() {
    const el = {
      songFile: document.getElementById('songFile'),
      songTitle: document.getElementById('songTitle'),
      showPlayerToggle: document.getElementById('showPlayerToggle'),
      visualizerWithSongToggle: document.getElementById('visualizerWithSongToggle'),
      songInfo: document.getElementById('songInfo'),
      visualizerEnabled: document.getElementById('visualizerEnabled'),
      visualizerType: document.getElementById('visualizerType'),
      visualizerColor: document.getElementById('visualizerColor'),
      backgroundFiles: document.getElementById('backgroundFiles'),
      backgroundMode: document.getElementById('backgroundMode'),
      backgroundColor: document.getElementById('backgroundColor'),
      backgroundList: document.getElementById('backgroundList'),
      lyricsInput: document.getElementById('lyricsInput'),
      parseLyricsBtn: document.getElementById('parseLyricsBtn'),
      clearLyricsBtn: document.getElementById('clearLyricsBtn'),
      applyAllEffect: document.getElementById('applyAllEffect'),
      applyAllFont: document.getElementById('applyAllFont'),
      applyAllTextColor: document.getElementById('applyAllTextColor'),
      applyAllOutlineColor: document.getElementById('applyAllOutlineColor'),
      applyAllOutlineWidth: document.getElementById('applyAllOutlineWidth'),
      desktopLyricScale: document.getElementById('desktopLyricScale'),
      mobileLyricScale: document.getElementById('mobileLyricScale'),
      mobileFullWidthLyrics: document.getElementById('mobileFullWidthLyrics'),
      lyricsTable: document.getElementById('lyricsTable'),
      fontFiles: document.getElementById('fontFiles'),
      fontPreviewList: document.getElementById('fontPreviewList'),
      recordFps: document.getElementById('recordFps'),
      recordBitrateMbps: document.getElementById('recordBitrateMbps'),
      saveAllBtn: document.getElementById('saveAllBtn'),
      saveStatus: document.getElementById('saveStatus'),
    };

    function markSaved(message) {
      saveConfig();
      el.saveStatus.textContent = `${message} • ${new Date().toLocaleTimeString('tr-TR')}`;
      clearTimeout(markSaved.timer);
      markSaved.timer = window.setTimeout(() => {
        el.saveStatus.textContent = '';
      }, 1700);
    }

    function renderSong() {
      const song = state.config.song;
      el.songTitle.value = song.title || '';
      el.showPlayerToggle.checked = !!song.showPlayer;
      el.visualizerWithSongToggle.checked = !!song.visualizerWithSong;
      el.songInfo.textContent = song.assetKey
        ? `${song.fileName || 'Şarkı'} yüklü • ${formatBytes(song.size)} • bağımsız kaydedildi`
        : 'Henüz şarkı yüklenmedi.';
    }

    function renderVisualizer() {
      el.visualizerEnabled.checked = !!state.config.visualizer.enabled;
      el.visualizerType.value = state.config.visualizer.type;
      el.visualizerColor.value = state.config.visualizer.color;
    }

    function renderBackground() {
      el.backgroundMode.value = state.config.background.mode;
      el.backgroundColor.value = state.config.background.color;
      if (!state.config.background.items.length) {
        el.backgroundList.innerHTML = '<span class="hint">Video/GIF eklenmedi. Yalnızca arkaplan rengi kullanılacak.</span>';
        return;
      }

      el.backgroundList.innerHTML = state.config.background.items
        .map((item, idx) => `<div class="manage-row">${idx + 1}. ${item.fileName} (${item.kind}) <button type="button" data-remove-bg="${item.id}">Sil</button></div>`)
        .join('');
    }

    function renderLyrics() {
      resolveLyricFontHints();
      el.applyAllEffect.innerHTML = effectOptionsWithRandom('');
      el.applyAllFont.innerHTML = `<option value="">Seçin</option>${fontOptions('', false, true)}`;

      const baseStyle = state.config.lyrics[0] || { textColor: '#ffffff', outlineColor: '#000000', outlineWidth: 3 };
      if (el.applyAllTextColor) el.applyAllTextColor.value = baseStyle.textColor || '#ffffff';
      if (el.applyAllOutlineColor) el.applyAllOutlineColor.value = baseStyle.outlineColor || '#000000';
      if (el.applyAllOutlineWidth) el.applyAllOutlineWidth.value = String(Number.isFinite(baseStyle.outlineWidth) ? baseStyle.outlineWidth : 3);
      if (el.desktopLyricScale) el.desktopLyricScale.value = String(state.config.lyricLayout?.desktopScale || 12);
      if (el.mobileLyricScale) el.mobileLyricScale.value = String(state.config.lyricLayout?.mobileScale || 12);
      if (el.mobileFullWidthLyrics) el.mobileFullWidthLyrics.checked = !!state.config.lyricLayout?.mobileFullWidth;

      if (!state.config.lyrics.length) {
        el.lyricsTable.innerHTML = '<p class="hint">Lyric yok. Feed yine de müzik/visualizer/arkaplan ile çalışır.</p>';
        return;
      }

      el.lyricsTable.innerHTML = state.config.lyrics
        .map((line) => `
          <article class="lyric-item">
            <details>
              <summary>
                <strong>[${line.start.toFixed(3)}]</strong>
                <strong>[${line.end.toFixed(3)}]</strong>
                <span>${line.text}</span>
              </summary>
              <div class="lyric-edit-body">
                <button type="button" data-edit-lyric="${line.id}">Metni Düzenle</button>
                <button type="button" data-delete-lyric="${line.id}">Bu Lyric'i Sil</button>
                <div class="grid two">
                  <label>Effect
                    <select data-line-effect="${line.id}">${effectOptions(line.effect || 'effect-fade')}</select>
                  </label>
                  <label>Font
                    <select data-line-font="${line.id}">${fontOptions(line.fontId || '')}</select>
                  </label>
                </div>
                <div class="style-grid">
                  <label>Yazı rengi
                    <input type="color" data-line-color="${line.id}" value="${line.textColor || '#ffffff'}" />
                  </label>
                  <label>Outline rengi
                    <input type="color" data-line-outline-color="${line.id}" value="${line.outlineColor || '#000000'}" />
                  </label>
                  <label>Outline kalınlığı (px)
                    <input type="range" min="0" max="14" step="1" data-line-outline-width="${line.id}" value="${Number.isFinite(line.outlineWidth) ? line.outlineWidth : 3}" />
                  </label>
                </div>
              </div>
            </details>
          </article>
        `)
        .join('');
    }

    function renderFonts() {
      if (!state.config.fonts.length) {
        el.fontPreviewList.innerHTML = '<p class="hint">Henüz font yüklenmedi.</p>';
        return;
      }

      el.fontPreviewList.innerHTML = state.config.fonts
        .map((font) => `
          <article class="font-card">
            <strong>${font.name}</strong>
            <div class="font-sample" style="font-family:'${font.family}'">Pulse Feed Lyric Preview</div>
            <button type="button" data-remove-font="${font.id}">Kaldır</button>
          </article>
        `)
        .join('');
    }

    function renderRecording() {
      if (el.recordFps) el.recordFps.value = String(Math.max(12, Math.min(120, Number(state.config.recording?.fps) || 60)));
      if (el.recordBitrateMbps) el.recordBitrateMbps.value = String(Math.max(4, Math.min(120, Number(state.config.recording?.bitrateMbps) || 80)));
    }

    function renderAll() {
      mountFontFaces();
      renderSong();
      renderVisualizer();
      renderBackground();
      renderLyrics();
      renderFonts();
      renderRecording();
    }

    el.songFile.addEventListener('change', async () => {
      const file = el.songFile.files?.[0];
      if (!file) return;
      if (!(/\.mp3$|\.wav$/i).test(file.name)) {
        alert('Sadece .mp3 ve .wav desteklenir.');
        el.songFile.value = '';
        return;
      }

      const key = `song-${uid()}`;
      await assetPut(key, file);
      await assetDelete(state.config.song.assetKey);
      revokeObjectUrl(state.config.song.objectUrl);

      state.config.song = {
        ...state.config.song,
        fileName: file.name,
        size: file.size,
        mimeType: file.type,
        assetKey: key,
        objectUrl: URL.createObjectURL(file),
      };

      renderSong();
      markSaved('Şarkı yüklendi ve kaydedildi');
    });

    el.songTitle.addEventListener('input', () => {
      state.config.song.title = el.songTitle.value.trim();
      markSaved('Şarkı adı kaydedildi');
    });

    el.showPlayerToggle.addEventListener('change', () => {
      state.config.song.showPlayer = el.showPlayerToggle.checked;
      markSaved('Player tercihi kaydedildi');
    });

    el.visualizerWithSongToggle.addEventListener('change', () => {
      state.config.song.visualizerWithSong = el.visualizerWithSongToggle.checked;
      markSaved('Visualizer bağlantısı kaydedildi');
    });

    el.visualizerEnabled.addEventListener('change', () => {
      state.config.visualizer.enabled = el.visualizerEnabled.checked;
      markSaved('Visualizer ayarı kaydedildi');
    });

    el.visualizerType.addEventListener('change', () => {
      state.config.visualizer.type = el.visualizerType.value;
      markSaved('Visualizer türü kaydedildi');
    });

    el.visualizerColor.addEventListener('input', () => {
      state.config.visualizer.color = el.visualizerColor.value;
      markSaved('Visualizer rengi kaydedildi');
    });

    el.backgroundMode.addEventListener('change', () => {
      state.config.background.mode = el.backgroundMode.value;
      renderBackground();
      markSaved('Arkaplan modu kaydedildi');
    });

    el.backgroundColor.addEventListener('input', () => {
      state.config.background.color = el.backgroundColor.value;
      markSaved('Arkaplan rengi kaydedildi');
    });

    el.backgroundFiles.addEventListener('change', async () => {
      const files = Array.from(el.backgroundFiles.files || []);
      if (!files.length) return;

      for (const file of files) {
        if (!(/\.(gif|mp4|mkv|webm)$/i).test(file.name)) continue;
        const key = `bg-${uid()}`;
        await assetPut(key, file);
        state.config.background.items.push({
          id: uid(),
          fileName: file.name,
          kind: /\.gif$/i.test(file.name) ? 'gif' : 'video',
          mimeType: file.type,
          assetKey: key,
          objectUrl: URL.createObjectURL(file),
        });
      }

      renderBackground();
      markSaved('Arkaplan dosyaları kaydedildi');
    });

    el.backgroundList.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-remove-bg]');
      if (!btn) return;
      const id = btn.getAttribute('data-remove-bg');
      const item = state.config.background.items.find((x) => x.id === id);
      if (item) {
        await assetDelete(item.assetKey);
        revokeObjectUrl(item.objectUrl);
      }
      state.config.background.items = state.config.background.items.filter((x) => x.id !== id);
      renderBackground();
      markSaved('Arkaplan öğesi silindi');
    });

    el.parseLyricsBtn.addEventListener('click', () => {
      const parsed = parseLyrics(el.lyricsInput.value);
      if (!parsed.length) {
        alert('Geçerli lyric satırı bulunamadı.');
        return;
      }
      state.config.lyrics = parsed;
      renderLyrics();
      markSaved('Lyrics kaydedildi');
    });

    el.clearLyricsBtn?.addEventListener('click', () => {
      state.config.lyrics = [];
      el.lyricsInput.value = '';
      renderLyrics();
      markSaved('Tüm lyricler silindi');
    });

    el.lyricsTable.addEventListener('click', (event) => {
      const editBtn = event.target.closest('[data-edit-lyric]');
      if (editBtn) {
        const id = editBtn.getAttribute('data-edit-lyric');
        const row = state.config.lyrics.find((x) => x.id === id);
        if (!row) return;
        const next = window.prompt('Yeni lyric', row.text);
        if (next === null) return;
        row.text = next.trim() || row.text;
        renderLyrics();
        markSaved('Lyric güncellendi');
        return;
      }

      const deleteBtn = event.target.closest('[data-delete-lyric]');
      if (!deleteBtn) return;
      const id = deleteBtn.getAttribute('data-delete-lyric');
      state.config.lyrics = state.config.lyrics.filter((x) => x.id !== id);
      renderLyrics();
      markSaved('Lyric silindi');
    });

    el.lyricsTable.addEventListener('change', (event) => {
      const eff = event.target.closest('[data-line-effect]');
      if (eff) {
        const row = state.config.lyrics.find((x) => x.id === eff.getAttribute('data-line-effect'));
        if (row) {
          row.effect = eff.value;
          markSaved('Lyric efekti kaydedildi');
        }
      }

      const fontSel = event.target.closest('[data-line-font]');
      if (fontSel) {
        const row = state.config.lyrics.find((x) => x.id === fontSel.getAttribute('data-line-font'));
        if (row) {
          row.fontId = fontSel.value;
          row.fontHint = '';
          markSaved('Lyric fontu kaydedildi');
        }
      }

      const colorSel = event.target.closest('[data-line-color]');
      if (colorSel) {
        const row = state.config.lyrics.find((x) => x.id === colorSel.getAttribute('data-line-color'));
        if (row) {
          row.textColor = colorSel.value;
          markSaved('Lyric yazı rengi kaydedildi');
        }
      }

      const outlineColorSel = event.target.closest('[data-line-outline-color]');
      if (outlineColorSel) {
        const row = state.config.lyrics.find((x) => x.id === outlineColorSel.getAttribute('data-line-outline-color'));
        if (row) {
          row.outlineColor = outlineColorSel.value;
          markSaved('Lyric outline rengi kaydedildi');
        }
      }

      const outlineWidthSel = event.target.closest('[data-line-outline-width]');
      if (outlineWidthSel) {
        const row = state.config.lyrics.find((x) => x.id === outlineWidthSel.getAttribute('data-line-outline-width'));
        if (row) {
          row.outlineWidth = Number(outlineWidthSel.value) || 0;
          markSaved('Lyric outline kalınlığı kaydedildi');
        }
      }
    });

    el.applyAllEffect.addEventListener('change', () => {
      if (!el.applyAllEffect.value) return;
      if (el.applyAllEffect.value === '__random__') {
        const effectValues = EFFECTS.map(([value]) => value);
        const selected = pickRandomStableByText(state.config.lyrics, () => effectValues[Math.floor(Math.random() * effectValues.length)]);
        state.config.lyrics = state.config.lyrics.map((x, idx) => ({ ...x, effect: selected[idx] }));
      } else {
        state.config.lyrics = state.config.lyrics.map((x) => ({ ...x, effect: el.applyAllEffect.value }));
      }
      renderLyrics();
      markSaved('Tüm lyric efektleri kaydedildi');
    });

    el.applyAllFont.addEventListener('change', () => {
      if (el.applyAllFont.value === '__random__') {
        const fontValues = state.config.fonts.map((x) => x.id);
        if (!fontValues.length) {
          alert('Random font için önce font yükleyin.');
          return;
        }
        const selected = pickRandomStableByText(state.config.lyrics, () => fontValues[Math.floor(Math.random() * fontValues.length)]);
        state.config.lyrics = state.config.lyrics.map((x, idx) => ({ ...x, fontId: selected[idx], fontHint: '' }));
      } else {
        state.config.lyrics = state.config.lyrics.map((x) => ({ ...x, fontId: el.applyAllFont.value, fontHint: '' }));
      }
      renderLyrics();
      markSaved('Tüm lyric fontları kaydedildi');
    });

    el.applyAllTextColor?.addEventListener('input', () => {
      state.config.lyrics = state.config.lyrics.map((x) => ({ ...x, textColor: el.applyAllTextColor.value }));
      markSaved('Tüm lyric yazı rengi kaydedildi');
    });

    el.applyAllOutlineColor?.addEventListener('input', () => {
      state.config.lyrics = state.config.lyrics.map((x) => ({ ...x, outlineColor: el.applyAllOutlineColor.value }));
      markSaved('Tüm lyric outline rengi kaydedildi');
    });

    el.applyAllOutlineWidth?.addEventListener('input', () => {
      const width = Number(el.applyAllOutlineWidth.value) || 0;
      state.config.lyrics = state.config.lyrics.map((x) => ({ ...x, outlineWidth: width }));
      markSaved('Tüm lyric outline kalınlığı kaydedildi');
    });

    el.desktopLyricScale?.addEventListener('input', () => {
      state.config.lyricLayout.desktopScale = Math.max(12, Number(el.desktopLyricScale.value) || 12);
      markSaved('Desktop lyric boyutu kaydedildi');
    });

    el.mobileLyricScale?.addEventListener('input', () => {
      state.config.lyricLayout.mobileScale = Math.max(12, Number(el.mobileLyricScale.value) || 12);
      markSaved('Mobile lyric boyutu kaydedildi');
    });

    el.mobileFullWidthLyrics?.addEventListener('change', () => {
      state.config.lyricLayout.mobileFullWidth = el.mobileFullWidthLyrics.checked;
      markSaved('Mobil tam genişlik lyric ayarı kaydedildi');
    });

    el.recordFps?.addEventListener('input', () => {
      state.config.recording.fps = Math.max(12, Math.min(120, Number(el.recordFps.value) || 60));
      markSaved('Kayıt FPS ayarı kaydedildi');
    });

    el.recordBitrateMbps?.addEventListener('input', () => {
      state.config.recording.bitrateMbps = Math.max(4, Math.min(120, Number(el.recordBitrateMbps.value) || 80));
      markSaved('Kayıt bitrate ayarı kaydedildi');
    });

    el.fontFiles.addEventListener('change', async () => {
      const files = Array.from(el.fontFiles.files || []);
      if (!files.length) return;

      for (const file of files) {
        if (!(/\.(woff2?|ttf|otf)$/i).test(file.name)) continue;
        const key = `font-${uid()}`;
        await assetPut(key, file);
        state.config.fonts.push({
          id: uid(),
          name: file.name.replace(/\.[^.]+$/, ''),
          family: `upload-${uid()}`,
          mimeType: file.type,
          assetKey: key,
          objectUrl: URL.createObjectURL(file),
        });
      }

      mountFontFaces();
      renderFonts();
      renderLyrics();
      markSaved('Fontlar kaydedildi');
    });

    el.fontPreviewList.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-remove-font]');
      if (!btn) return;
      const id = btn.getAttribute('data-remove-font');
      const font = state.config.fonts.find((x) => x.id === id);
      if (font) {
        await assetDelete(font.assetKey);
        revokeObjectUrl(font.objectUrl);
      }
      state.config.fonts = state.config.fonts.filter((x) => x.id !== id);
      state.config.lyrics = state.config.lyrics.map((x) => ({ ...x, fontId: x.fontId === id ? '' : x.fontId }));
      mountFontFaces();
      renderFonts();
      renderLyrics();
      markSaved('Font kaldırıldı');
    });

    document.querySelectorAll('[data-save-section]').forEach((btn) => {
      btn.addEventListener('click', () => markSaved(`${btn.getAttribute('data-save-section')} ayarları kaydedildi`));
    });

    el.saveAllBtn.addEventListener('click', () => markSaved('Tüm ayarlar kaydedildi'));
    renderAll();
  }

  function bindFeed() {
    mountFontFaces();
    const noRecordMode = page === 'feed-norec';

    const el = {
      feedStage: document.getElementById('feedStage'),
      backgroundLayer: document.getElementById('backgroundLayer'),
      lyricsZone: document.getElementById('lyricsZone'),
      lyricLine: document.getElementById('lyricLine'),
      musicPlayer: document.getElementById('musicPlayer'),
      playerSongName: document.getElementById('playerSongName'),
      playBtn: document.getElementById('playBtn'),
      stagePlayBtn: document.getElementById('stagePlayBtn'),
      seekBar: document.getElementById('seekBar'),
      currentTime: document.getElementById('currentTime'),
      duration: document.getElementById('duration'),
      audio: document.getElementById('audio'),
      recordBtn: document.getElementById('recordBtn'),
      panelRecordBtn: document.getElementById('panelRecordBtn'),
      downloadRecord: document.getElementById('downloadRecord'),
      visualizerTop: document.getElementById('visualizerTop'),
      visualizerBottom: document.getElementById('visualizerBottom'),
      playerViz: document.getElementById('playerViz'),
    };

    function syncNoRecordModeUI() {
      if (!noRecordMode) return;
      document.body.classList.toggle('no-record-playing', !el.audio.paused);
    }

    const zones = Array.from(document.querySelectorAll('.visualizer-zone'));

    const targetStageSize = page === 'mobile' ? { width: 2160, height: 3840 } : { width: 3840, height: 2160 };
    el.feedStage.dataset.targetResolution = `${targetStageSize.width}x${targetStageSize.height}`;

    function getRecordingPrefs() {
      const fps = Math.max(12, Math.min(120, Number(state.config.recording?.fps) || 60));
      const bitrateMbps = Math.max(4, Math.min(120, Number(state.config.recording?.bitrateMbps) || 80));
      const bitrate = Math.round(bitrateMbps * 1_000_000);
      return { fps, bitrate };
    }

    function applyStageScale() {
      const shell = el.feedStage.parentElement;
      const vw = window.innerWidth - 20;
      const vh = window.innerHeight - 20;
      const fitScale = Math.max(0.05, Math.min(vw / targetStageSize.width, vh / targetStageSize.height));
      const scale = Math.max(0.05, fitScale);
      el.feedStage.classList.add('scaled-stage');
      el.feedStage.style.setProperty('--stage-scale', String(scale));
      shell.style.width = `${Math.floor(targetStageSize.width * scale)}px`;
      shell.style.height = `${Math.floor(targetStageSize.height * scale)}px`;
    }

    function resizeCanvas(canvas) {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { ctx, w: rect.width, h: rect.height };
    }

    function pickFont(fontId) {
      const font = state.config.fonts.find((x) => x.id === fontId);
      return font ? `'${font.family}', Inter, sans-serif` : 'Inter, sans-serif';
    }

    function applyModeVisibility() {
      const vizEnabled = !!(state.config.visualizer.enabled && state.config.song.visualizerWithSong);
      zones.forEach((zone) => zone.classList.toggle('hidden', !vizEnabled));
      el.musicPlayer.classList.toggle('hidden', !state.config.song.showPlayer);
    }

    function applyLyricAreaLayout() {
      const isMobile = page === 'mobile';
      if (!isMobile) {
        el.lyricsZone.style.left = '8%';
        el.lyricsZone.style.width = '84%';
        el.lyricsZone.style.top = '21%';
        el.lyricsZone.style.height = '58%';
        return;
      }
      const full = !!state.config.lyricLayout?.mobileFullWidth;
      el.lyricsZone.style.left = full ? '2%' : '6%';
      el.lyricsZone.style.width = full ? '96%' : '88%';
      el.lyricsZone.style.top = '21%';
      el.lyricsZone.style.height = '58%';
    }

    function setRecordingUI(active) {
      state.isRecording = active;
      document.body.classList.toggle('recording-mode', active);
      if (active) {
        if (state.stopOnTapHandler) el.feedStage.removeEventListener('pointerdown', state.stopOnTapHandler);
        state.stopOnTapHandler = () => {
          stopRecording();
        };
        el.feedStage.addEventListener('pointerdown', state.stopOnTapHandler);
      } else if (state.stopOnTapHandler) {
        el.feedStage.removeEventListener('pointerdown', state.stopOnTapHandler);
        state.stopOnTapHandler = null;
      }
    }

    function setupBackground() {
      el.backgroundLayer.innerHTML = '';
      el.feedStage.style.background = state.config.background.color || '#040812';
      const items = state.config.background.items.filter((x) => x.objectUrl);
      if (!items.length) return;

      const mode = state.config.background.mode;
      const mount = (index) => {
        const item = items[index % items.length];
        el.backgroundLayer.innerHTML = '';

        if (item.kind === 'gif') {
          const img = document.createElement('img');
          img.src = item.objectUrl;
          img.alt = 'background';
          el.backgroundLayer.appendChild(img);
          if (mode === 'list' && items.length > 1) {
            window.setTimeout(() => mount((index + 1) % items.length), 8000);
          }
          return;
        }

        const video = document.createElement('video');
        video.src = item.objectUrl;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.loop = mode === 'loop';
        video.onended = () => {
          if (mode === 'list') mount((index + 1) % items.length);
        };
        el.backgroundLayer.appendChild(video);
      };

      mount(0);
    }

    function setupAudio() {
      const song = state.config.song;
      if (!song.objectUrl) {
        el.playerSongName.textContent = 'Şarkı yüklenmedi';
        el.stagePlayBtn.disabled = true;
        el.stagePlayBtn.textContent = 'Şarkı yok';
        return;
      }
      el.audio.src = song.objectUrl;
      el.playerSongName.textContent = song.title || song.fileName || 'Yüklenen şarkı';
      el.stagePlayBtn.disabled = false;
      el.stagePlayBtn.textContent = '▶ Müziği Başlat / Durdur';
    }

    function ensureAudioGraph() {
      if (state.audioCtx) return;
      state.audioCtx = new AudioContext();
      const source = state.audioCtx.createMediaElementSource(el.audio);
      state.analyser = state.audioCtx.createAnalyser();
      state.analyser.fftSize = 512;
      source.connect(state.analyser);
      state.analyser.connect(state.audioCtx.destination);
      state.audioData = new Uint8Array(state.analyser.frequencyBinCount);
    }

    function drawBar(ctx, w, h, color) {
      ctx.clearRect(0, 0, w, h);
      if (!state.analyser) return;
      state.analyser.getByteFrequencyData(state.audioData);
      const bars = 96;
      const bw = w / bars;
      const maxBin = Math.max(8, Math.floor(state.audioData.length * 0.68));
      const center = (bars - 1) / 2;
      ctx.fillStyle = color;
      for (let i = 0; i < bars; i += 1) {
        const ratio = i / (bars - 1);
        const idx = Math.floor(ratio * maxBin);
        const amp = state.audioData[idx] / 255;
        const distance = 1 - Math.abs(i - center) / center;
        const bh = Math.max(2, amp * h * (0.24 + distance * 0.92));
        const barThickness = Math.max(1.2, bw * 0.48);
        const x = i * bw + (bw - barThickness) / 2;
        ctx.fillRect(x, (h - bh) / 2, barThickness, bh);
      }
    }

    function drawWave(ctx, w, h, color) {
      ctx.clearRect(0, 0, w, h);
      if (!state.analyser) return;
      state.analyser.getByteTimeDomainData(state.audioData);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < state.audioData.length; i += 1) {
        const x = (i / (state.audioData.length - 1)) * w;
        const y = (state.audioData[i] / 255) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    function drawParticle(ctx, w, h, color) {
      ctx.clearRect(0, 0, w, h);
      if (!state.analyser) return;
      state.analyser.getByteFrequencyData(state.audioData);
      const cy = h / 2;
      for (let i = 0; i < 130; i += 1) {
        const amp = state.audioData[i % state.audioData.length] / 255;
        const x = (i / 130) * w;
        const y = cy + (Math.random() - 0.5) * amp * h * 0.5;
        ctx.globalAlpha = 0.25 + amp * 0.75;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 1 + amp * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function renderVisualizer() {
      const enabled = state.config.visualizer.enabled && state.config.song.visualizerWithSong && !el.audio.paused && !!state.analyser;
      if (!enabled) return;

      for (const canvas of [el.visualizerTop, el.visualizerBottom, el.playerViz]) {
        const { ctx, w, h } = resizeCanvas(canvas);
        if (state.config.visualizer.type === 'bar') drawBar(ctx, w, h, state.config.visualizer.color);
        if (state.config.visualizer.type === 'wave') drawWave(ctx, w, h, state.config.visualizer.color);
        if (state.config.visualizer.type === 'particle') drawParticle(ctx, w, h, state.config.visualizer.color);
      }

      state.visualizerRaf = requestAnimationFrame(renderVisualizer);
    }

    function fitLyric(text, fontFamily) {
      const mobileMode = page === 'mobile';
      const scale = mobileMode ? (state.config.lyricLayout?.mobileScale || 12) : (state.config.lyricLayout?.desktopScale || 12);
      const size = Math.max(12, Number(scale) || 12);

      el.lyricLine.style.fontFamily = fontFamily;
      el.lyricLine.style.whiteSpace = mobileMode ? 'normal' : 'nowrap';
      el.lyricLine.style.textAlign = 'center';
      el.lyricLine.textContent = text;
      el.lyricLine.style.fontSize = `${size}px`;
    }

    function activateLyric(line) {
      fitLyric(line.text, pickFont(line.fontId));
      const dur = Math.max(0.2, line.end - line.start);
      el.lyricLine.style.setProperty('--lyric-duration', `${Math.max(0.15, dur * 0.92)}s`);
      el.lyricLine.style.setProperty('--lyric-color', line.textColor || '#ffffff');
      el.lyricLine.style.setProperty('--lyric-outline-color', line.outlineColor || '#000000');
      el.lyricLine.style.setProperty('--lyric-outline-width', `${Number.isFinite(line.outlineWidth) ? line.outlineWidth : 3}px`);
      el.lyricLine.className = `lyric-line ${line.effect || 'effect-fade'}`;
      state.activeLyricId = line.id;
    }

    function lyricLoop() {
      const lines = state.config.lyrics;
      if (!lines.length || el.audio.paused) {
        requestAnimationFrame(lyricLoop);
        return;
      }

      const t = el.audio.currentTime;
      const current = lines.find((line) => t >= line.start && t <= line.end);
      if (!current) {
        state.activeLyricId = null;
        el.lyricLine.className = 'lyric-line';
        el.lyricLine.textContent = '';
      } else if (state.activeLyricId !== current.id) {
        activateLyric(current);
      }

      if (current && current.effect === 'effect-audio-reactive' && state.analyser) {
        state.analyser.getByteFrequencyData(state.audioData);
        const avg = state.audioData.reduce((sum, x) => sum + x, 0) / state.audioData.length;
        el.lyricLine.style.transform = `scale(${(1 + (avg / 255) * 0.12).toFixed(3)})`;
      } else {
        el.lyricLine.style.transform = '';
      }

      requestAnimationFrame(lyricLoop);
    }

    function updateTime() {
      el.currentTime.textContent = timeLabel(el.audio.currentTime);
      el.duration.textContent = timeLabel(el.audio.duration);
      if (Number.isFinite(el.audio.duration) && el.audio.duration > 0) {
        el.seekBar.value = String((el.audio.currentTime / el.audio.duration) * 100);
      }

      maybeStopRecordingAtSongEnd();
    }

    function maybeStopRecordingAtSongEnd() {
      if (!state.mediaRecorder || state.mediaRecorder.state !== 'recording') return;
      const duration = Number(el.audio.duration);
      const current = Number(el.audio.currentTime);
      const reachedEndByTime = Number.isFinite(duration) && duration > 0 && current >= (duration - 0.08);
      if (el.audio.ended || reachedEndByTime) {
        stopRecording();
      }
    }

    async function togglePlay() {
      if (!state.config.song.objectUrl) {
        alert('Önce admin panelden şarkı yükleyin.');
        return;
      }

      ensureAudioGraph();
      if (state.audioCtx.state === 'suspended') await state.audioCtx.resume();

      if (el.audio.paused) {
        await el.audio.play();
        el.playBtn.textContent = '⏸';
        el.stagePlayBtn.textContent = '⏸ Müziği Duraklat';
        cancelAnimationFrame(state.visualizerRaf);
        renderVisualizer();
      } else {
        el.audio.pause();
        el.playBtn.textContent = '▶';
        el.stagePlayBtn.textContent = '▶ Müziği Başlat';
      }

      syncNoRecordModeUI();
    }

    async function startRecording(panelOnly = false) {
      if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
        alert('Bu tarayıcı ekran kaydını desteklemiyor.');
        return;
      }
      try {
        if (document.fullscreenElement !== el.feedStage) await el.feedStage.requestFullscreen();

        const targetWidth = targetStageSize.width;
        const targetHeight = targetStageSize.height;

        state.stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: 'browser',
            cursor: 'never',
            frameRate: { ideal: getRecordingPrefs().fps, max: getRecordingPrefs().fps },
            width: { ideal: targetWidth, max: targetWidth },
            height: { ideal: targetHeight, max: targetHeight },
            aspectRatio: { ideal: targetWidth / targetHeight },
          },
          audio: false,
          preferCurrentTab: true,
          selfBrowserSurface: 'include',
          surfaceSwitching: 'exclude',
        });

        const videoTrack = state.stream.getVideoTracks()[0];
        const settings = videoTrack?.getSettings?.() || {};
        if (settings.displaySurface && settings.displaySurface !== 'browser') {
          state.stream.getTracks().forEach((t) => t.stop());
          state.stream = null;
          alert('Lütfen kayıt için yalnızca tarayıcı sekmesini seçin (pencere/ekran değil).');
          return;
        }

        if (panelOnly) {
          try {
            if (!window.CropTarget || !videoTrack.cropTo) {
              throw new Error('crop-api-missing');
            }
            const target = await window.CropTarget.fromElement(el.feedStage);
            await videoTrack.cropTo(target);
          } catch {
            state.stream.getTracks().forEach((t) => t.stop());
            state.stream = null;
            alert('Bu tarayıcı panel-özel kaydı desteklemiyor. Normal kayıtı kullanabilirsiniz.');
            return;
          }
        }

        try {
          await videoTrack.applyConstraints({
            width: { exact: targetWidth },
            height: { exact: targetHeight },
            frameRate: { ideal: getRecordingPrefs().fps, max: getRecordingPrefs().fps },
          });
        } catch {
          // browser may reject exact constraints depending on capture source
        }

        state.recordTarget = { width: targetWidth, height: targetHeight };

        state.chunks = [];
        const preferredMime = [
          'video/webm;codecs=vp8',
          'video/webm;codecs=vp9',
          'video/webm',
        ].find((mime) => MediaRecorder.isTypeSupported(mime)) || 'video/webm';
        state.recordMime = preferredMime;
        state.mediaRecorder = new MediaRecorder(state.stream, {
          mimeType: preferredMime,
          videoBitsPerSecond: getRecordingPrefs().bitrate,
        });
        state.mediaRecorder.ondataavailable = (event) => {
          if (event.data?.size) state.chunks.push(event.data);
        };
        state.mediaRecorder.onstop = () => {
          if (!state.chunks.length) {
            alert('Kayıt verisi oluşmadı. Lütfen tekrar deneyin.');
            setRecordingUI(false);
            state.stream?.getTracks().forEach((t) => t.stop());
            state.stream = null;
            state.recordTarget = null;
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            applyModeVisibility();
            return;
          }

          const finalBlob = new Blob(state.chunks, { type: state.recordMime.split(';')[0] || 'video/webm' });
          if (state.downloadUrl) {
            URL.revokeObjectURL(state.downloadUrl);
            state.downloadUrl = '';
          }
          state.downloadUrl = URL.createObjectURL(finalBlob);
          el.downloadRecord.href = state.downloadUrl;
          el.downloadRecord.download = page === 'mobile' ? 'lyric-video-mobile.webm' : 'lyric-video.webm';
          el.downloadRecord.classList.remove('hidden');
          el.downloadRecord.click();
          el.recordBtn.textContent = '🎥 Fullscreen Kayda Başla';
          setRecordingUI(false);
          state.stream?.getTracks().forEach((t) => t.stop());
          state.stream = null;
          state.recordTarget = null;
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          applyModeVisibility();
        };

        state.mediaRecorder.start(1000);
        setRecordingUI(true);
        el.recordBtn.textContent = '⏹ Kaydı Durdur';
        if (!state.config.song.showPlayer) el.musicPlayer.classList.add('hidden');
        if (el.audio.paused) await togglePlay();
      } catch {
        setRecordingUI(false);
        alert('Kayıt başlatılamadı. İzinleri kontrol edin.');
      }
    }

    function stopRecording() {
      if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') return;
      try {
        state.mediaRecorder.requestData();
      } catch {
        // ignore requestData errors close to stop
      }
      state.mediaRecorder.stop();
    }

    el.playBtn.addEventListener('click', togglePlay);
    el.stagePlayBtn.addEventListener('click', togglePlay);
    el.audio.addEventListener('timeupdate', updateTime);
    el.audio.addEventListener('loadedmetadata', updateTime);
    el.audio.addEventListener('ended', () => {
      el.playBtn.textContent = '▶';
      el.stagePlayBtn.textContent = '▶ Müziği Başlat';
      maybeStopRecordingAtSongEnd();
      syncNoRecordModeUI();
    });

    el.audio.addEventListener('pause', () => {
      maybeStopRecordingAtSongEnd();
      syncNoRecordModeUI();
    });

    el.audio.addEventListener('play', syncNoRecordModeUI);

    el.seekBar.addEventListener('input', () => {
      if (!Number.isFinite(el.audio.duration) || el.audio.duration <= 0) return;
      el.audio.currentTime = (Number(el.seekBar.value) / 100) * el.audio.duration;
      updateTime();
    });

    el.recordBtn?.addEventListener('click', () => {
      if (state.mediaRecorder && state.mediaRecorder.state === 'recording') stopRecording();
      else startRecording(false);
    });

    el.panelRecordBtn?.addEventListener('click', () => {
      if (state.mediaRecorder && state.mediaRecorder.state === 'recording') stopRecording();
      else startRecording(true);
    });

    applyStageScale();
    applyModeVisibility();
    applyLyricAreaLayout();
    setupBackground();
    setupAudio();
    lyricLoop();

    window.addEventListener('resize', () => {
      applyStageScale();
      applyLyricAreaLayout();
    });
  }

  async function init() {
    await hydrateAssetUrls();
    if (page === 'admin') bindAdmin();
    if (page === 'feed' || page === 'mobile' || page === 'feed-norec') bindFeed();
  }

  init();
})();
