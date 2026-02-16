(() => {
  const STORAGE_KEY = 'pulse.lyricVideoConfig.v1';

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
      dataUrl: '',
      fileName: '',
      size: 0,
      showPlayer: true,
      visualizerWithSong: false,
    },
    visualizer: {
      enabled: false,
      type: 'bar',
      color: '#5f87ff',
    },
    background: {
      mode: 'loop',
      color: '#040812',
      items: [],
    },
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
    lyricRaf: 0,
    currentBgIndex: 0,
    mediaRecorder: null,
    chunks: [],
    stream: null,
  };

  function loadConfig() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw) return structuredClone(defaultConfig);
      return {
        ...structuredClone(defaultConfig),
        ...raw,
        song: { ...defaultConfig.song, ...(raw.song || {}) },
        visualizer: { ...defaultConfig.visualizer, ...(raw.visualizer || {}) },
        background: { ...defaultConfig.background, ...(raw.background || {}) },
        lyrics: Array.isArray(raw.lyrics) ? raw.lyrics : [],
        fonts: Array.isArray(raw.fonts) ? raw.fonts : [],
      };
    } catch {
      return structuredClone(defaultConfig);
    }
  }

  function saveConfig() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
  }

  function uid() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function timeLabel(seconds) {
    if (!Number.isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function parseLyrics(raw) {
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return lines
      .map((line) => {
        const [start, end, ...textParts] = line.split('|');
        const text = textParts.join('|').trim();
        const startNum = Number(start);
        const endNum = Number(end);
        if (!Number.isFinite(startNum) || !Number.isFinite(endNum) || !text) return null;
        return {
          id: uid(),
          start: startNum,
          end: endNum,
          text,
          effect: 'effect-fade',
          fontId: '',
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.start - b.start);
  }

  function effectOptions(selected) {
    return EFFECTS.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
  }

  function fontOptions(selected, includeEmpty = true) {
    const opts = [];
    if (includeEmpty) opts.push('<option value="">Varsayılan</option>');
    for (const font of state.config.fonts) {
      opts.push(`<option value="${font.id}" ${selected === font.id ? 'selected' : ''}>${font.name}</option>`);
    }
    return opts.join('');
  }

  function mountFontFaces() {
    let styleEl = document.getElementById('dynamicFontFaces');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'dynamicFontFaces';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = state.config.fonts
      .map((font) => `@font-face { font-family: '${font.family}'; src: url('${font.dataUrl}'); font-display: swap; }`)
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
      applyAllEffect: document.getElementById('applyAllEffect'),
      applyAllFont: document.getElementById('applyAllFont'),
      lyricsTable: document.getElementById('lyricsTable'),
      fontFiles: document.getElementById('fontFiles'),
      fontPreviewList: document.getElementById('fontPreviewList'),
      saveAllBtn: document.getElementById('saveAllBtn'),
      saveStatus: document.getElementById('saveStatus'),
    };

    function renderSongInfo() {
      const song = state.config.song;
      el.songTitle.value = song.title || '';
      el.showPlayerToggle.checked = !!song.showPlayer;
      el.visualizerWithSongToggle.checked = !!song.visualizerWithSong;
      if (song.dataUrl) {
        el.songInfo.textContent = `${song.fileName || 'Şarkı'} yüklü • ${formatBytes(song.size)} • feed sayfasında kullanılacak`;
      } else {
        el.songInfo.textContent = 'Henüz şarkı yüklenmedi.';
      }
    }

    function renderVisualizer() {
      el.visualizerEnabled.checked = !!state.config.visualizer.enabled;
      el.visualizerType.value = state.config.visualizer.type;
      el.visualizerColor.value = state.config.visualizer.color;
    }

    function renderBackgroundList() {
      el.backgroundMode.value = state.config.background.mode;
      el.backgroundColor.value = state.config.background.color;
      if (!state.config.background.items.length) {
        el.backgroundList.innerHTML = '<span class="hint">Video/GIF eklenmedi. Feed arkaplanı düz renk olacak.</span>';
        return;
      }

      el.backgroundList.innerHTML = state.config.background.items
        .map((item, index) => `<div class="manage-row">${index + 1}. ${item.fileName} (${item.kind}) <button type="button" data-remove-bg="${item.id}">Sil</button></div>`)
        .join('');
    }

    function renderLyricsTable() {
      el.applyAllEffect.innerHTML = `<option value="">Seçin</option>${effectOptions('')}`;
      el.applyAllFont.innerHTML = `<option value="">Seçin</option>${fontOptions('', false)}`;

      if (!state.config.lyrics.length) {
        el.lyricsTable.innerHTML = '<p class="hint">Henüz lyric satırı yok.</p>';
        return;
      }

      el.lyricsTable.innerHTML = state.config.lyrics
        .map((line) => `
          <article class="lyric-item" data-id="${line.id}">
            <div class="lyric-item-top">
              <strong>[${line.start.toFixed(3)}]</strong>
              <strong>[${line.end.toFixed(3)}]</strong>
              <span>${line.text}</span>
              <button type="button" data-edit-lyric="${line.id}">Edit</button>
            </div>
            <div class="grid two">
              <label>Effect
                <select data-line-effect="${line.id}">${effectOptions(line.effect || 'effect-fade')}</select>
              </label>
              <label>Font
                <select data-line-font="${line.id}">${fontOptions(line.fontId || '')}</select>
              </label>
            </div>
            <small class="lyric-meta">Süre: ${(line.end - line.start).toFixed(3)}sn</small>
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

    function renderAll() {
      mountFontFaces();
      renderSongInfo();
      renderVisualizer();
      renderBackgroundList();
      renderLyricsTable();
      renderFonts();
    }

    el.songFile.addEventListener('change', async () => {
      const file = el.songFile.files?.[0];
      if (!file) return;
      const ext = file.name.toLowerCase();
      if (!(/\.mp3$|\.wav$/).test(ext)) {
        alert('Sadece .mp3 ve .wav desteklenir.');
        el.songFile.value = '';
        return;
      }
      const dataUrl = await readAsDataUrl(file);
      state.config.song = {
        ...state.config.song,
        dataUrl,
        fileName: file.name,
        size: file.size,
      };
      saveConfig();
      renderSongInfo();
    });

    el.songTitle.addEventListener('input', () => {
      state.config.song.title = el.songTitle.value.trim();
      saveConfig();
    });

    el.showPlayerToggle.addEventListener('change', () => {
      state.config.song.showPlayer = el.showPlayerToggle.checked;
      saveConfig();
    });

    el.visualizerWithSongToggle.addEventListener('change', () => {
      state.config.song.visualizerWithSong = el.visualizerWithSongToggle.checked;
      saveConfig();
    });

    el.visualizerEnabled.addEventListener('change', () => {
      state.config.visualizer.enabled = el.visualizerEnabled.checked;
      saveConfig();
    });

    el.visualizerType.addEventListener('change', () => {
      state.config.visualizer.type = el.visualizerType.value;
      saveConfig();
    });

    el.visualizerColor.addEventListener('input', () => {
      state.config.visualizer.color = el.visualizerColor.value;
      saveConfig();
    });

    el.backgroundMode.addEventListener('change', () => {
      state.config.background.mode = el.backgroundMode.value;
      saveConfig();
      renderBackgroundList();
    });

    el.backgroundColor.addEventListener('input', () => {
      state.config.background.color = el.backgroundColor.value;
      saveConfig();
    });

    el.backgroundFiles.addEventListener('change', async () => {
      const files = Array.from(el.backgroundFiles.files || []);
      if (!files.length) return;

      const accepted = [];
      for (const file of files) {
        const ext = file.name.toLowerCase();
        if (!(/\.gif$|\.mp4$|\.mkv$|\.webm$/).test(ext)) {
          continue;
        }
        accepted.push({
          id: uid(),
          fileName: file.name,
          kind: ext.endsWith('.gif') ? 'gif' : 'video',
          dataUrl: await readAsDataUrl(file),
        });
      }

      state.config.background.items = accepted;
      saveConfig();
      renderBackgroundList();
    });

    el.backgroundList.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-remove-bg]');
      if (!btn) return;
      const id = btn.getAttribute('data-remove-bg');
      state.config.background.items = state.config.background.items.filter((x) => x.id !== id);
      saveConfig();
      renderBackgroundList();
    });

    el.parseLyricsBtn.addEventListener('click', () => {
      const parsed = parseLyrics(el.lyricsInput.value);
      if (!parsed.length) {
        alert('Geçerli lyric satırı bulunamadı. Format: start|end|lyric');
        return;
      }
      state.config.lyrics = parsed;
      saveConfig();
      renderLyricsTable();
    });

    el.lyricsTable.addEventListener('click', (event) => {
      const editBtn = event.target.closest('[data-edit-lyric]');
      if (!editBtn) return;
      const id = editBtn.getAttribute('data-edit-lyric');
      const current = state.config.lyrics.find((x) => x.id === id);
      if (!current) return;
      const next = window.prompt('Yeni lyric metni', current.text);
      if (next === null) return;
      current.text = next.trim() || current.text;
      saveConfig();
      renderLyricsTable();
    });

    el.lyricsTable.addEventListener('change', (event) => {
      const effectSelect = event.target.closest('[data-line-effect]');
      if (effectSelect) {
        const id = effectSelect.getAttribute('data-line-effect');
        const row = state.config.lyrics.find((x) => x.id === id);
        if (row) {
          row.effect = effectSelect.value;
          saveConfig();
        }
      }

      const fontSelect = event.target.closest('[data-line-font]');
      if (fontSelect) {
        const id = fontSelect.getAttribute('data-line-font');
        const row = state.config.lyrics.find((x) => x.id === id);
        if (row) {
          row.fontId = fontSelect.value;
          saveConfig();
        }
      }
    });

    el.applyAllEffect.addEventListener('change', () => {
      if (!el.applyAllEffect.value) return;
      state.config.lyrics = state.config.lyrics.map((x) => ({ ...x, effect: el.applyAllEffect.value }));
      saveConfig();
      renderLyricsTable();
    });

    el.applyAllFont.addEventListener('change', () => {
      state.config.lyrics = state.config.lyrics.map((x) => ({ ...x, fontId: el.applyAllFont.value }));
      saveConfig();
      renderLyricsTable();
    });

    el.fontFiles.addEventListener('change', async () => {
      const files = Array.from(el.fontFiles.files || []);
      if (!files.length) return;
      for (const file of files) {
        if (!(/\.(woff2?|ttf|otf)$/i).test(file.name)) continue;
        const dataUrl = await readAsDataUrl(file);
        const name = file.name.replace(/\.[^.]+$/, '');
        state.config.fonts.push({
          id: uid(),
          name,
          family: `upload-${uid()}`,
          dataUrl,
        });
      }
      saveConfig();
      renderFonts();
      renderLyricsTable();
      mountFontFaces();
    });

    el.fontPreviewList.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-remove-font]');
      if (!btn) return;
      const id = btn.getAttribute('data-remove-font');
      state.config.fonts = state.config.fonts.filter((x) => x.id !== id);
      state.config.lyrics = state.config.lyrics.map((x) => ({ ...x, fontId: x.fontId === id ? '' : x.fontId }));
      saveConfig();
      renderFonts();
      renderLyricsTable();
      mountFontFaces();
    });

    el.saveAllBtn.addEventListener('click', () => {
      saveConfig();
      el.saveStatus.textContent = `Kaydedildi • ${new Date().toLocaleTimeString('tr-TR')}`;
      window.setTimeout(() => {
        el.saveStatus.textContent = '';
      }, 2000);
    });

    renderAll();
  }

  function bindFeed() {
    mountFontFaces();

    const el = {
      feedStage: document.getElementById('feedStage'),
      backgroundLayer: document.getElementById('backgroundLayer'),
      lyricsZone: document.getElementById('lyricsZone'),
      lyricLine: document.getElementById('lyricLine'),
      musicPlayer: document.getElementById('musicPlayer'),
      playerSongName: document.getElementById('playerSongName'),
      playBtn: document.getElementById('playBtn'),
      seekBar: document.getElementById('seekBar'),
      currentTime: document.getElementById('currentTime'),
      duration: document.getElementById('duration'),
      audio: document.getElementById('audio'),
      recordBtn: document.getElementById('recordBtn'),
      downloadRecord: document.getElementById('downloadRecord'),
      visualizerTop: document.getElementById('visualizerTop'),
      visualizerBottom: document.getElementById('visualizerBottom'),
      playerViz: document.getElementById('playerViz'),
    };

    function resizeCanvas(canvas) {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    }

    function pickFontFamily(fontId) {
      if (!fontId) return 'Inter, Segoe UI, sans-serif';
      const font = state.config.fonts.find((x) => x.id === fontId);
      return font ? `'${font.family}', Inter, Segoe UI, sans-serif` : 'Inter, Segoe UI, sans-serif';
    }

    function setupBackground() {
      el.backgroundLayer.innerHTML = '';
      el.feedStage.style.background = state.config.background.color || '#040812';
      const items = state.config.background.items || [];
      if (!items.length) return;

      state.currentBgIndex = 0;
      const mode = state.config.background.mode;

      function mount(index) {
        const item = items[index % items.length];
        el.backgroundLayer.innerHTML = '';
        if (item.kind === 'gif') {
          const img = document.createElement('img');
          img.src = item.dataUrl;
          img.alt = 'Background gif';
          el.backgroundLayer.appendChild(img);
          if (mode === 'list' && items.length > 1) {
            window.setTimeout(() => {
              state.currentBgIndex = (state.currentBgIndex + 1) % items.length;
              mount(state.currentBgIndex);
            }, 8000);
          }
          return;
        }

        const video = document.createElement('video');
        video.src = item.dataUrl;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.loop = mode === 'loop';
        video.addEventListener('ended', () => {
          if (mode === 'list') {
            state.currentBgIndex = (state.currentBgIndex + 1) % items.length;
            mount(state.currentBgIndex);
          }
        });
        el.backgroundLayer.appendChild(video);
      }

      mount(0);
    }

    function setupAudio() {
      const { song } = state.config;
      if (!song.dataUrl) return;
      el.audio.src = song.dataUrl;
      el.playerSongName.textContent = song.title || song.fileName || 'Yüklenen şarkı';
      el.musicPlayer.classList.toggle('hidden', !song.showPlayer);
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

    function drawBar(ctx, width, height, color) {
      ctx.clearRect(0, 0, width, height);
      if (!state.analyser) return;
      state.analyser.getByteFrequencyData(state.audioData);
      const bars = 48;
      const barW = width / bars;
      const center = (bars - 1) / 2;
      ctx.fillStyle = color;
      for (let i = 0; i < bars; i += 1) {
        const index = Math.floor((i / bars) * state.audioData.length);
        const amp = state.audioData[index] / 255;
        const distance = 1 - Math.abs(i - center) / center;
        const h = Math.max(3, amp * height * (0.2 + distance * 0.9));
        const x = i * barW + 1;
        const y = (height - h) / 2;
        ctx.fillRect(x, y, Math.max(2, barW - 2), h);
      }
    }

    function drawWave(ctx, width, height, color) {
      ctx.clearRect(0, 0, width, height);
      if (!state.analyser) return;
      state.analyser.getByteTimeDomainData(state.audioData);
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let i = 0; i < state.audioData.length; i += 1) {
        const x = (i / (state.audioData.length - 1)) * width;
        const y = (state.audioData[i] / 255) * height;
        if (!i) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    function drawParticle(ctx, width, height, color) {
      ctx.clearRect(0, 0, width, height);
      if (!state.analyser) return;
      state.analyser.getByteFrequencyData(state.audioData);
      const centerY = height / 2;
      for (let i = 0; i < 130; i += 1) {
        const idx = i % state.audioData.length;
        const amp = state.audioData[idx] / 255;
        const x = (i / 130) * width;
        const spread = amp * height * 0.5;
        const y = centerY + (Math.random() - 0.5) * spread;
        const size = 1 + amp * 4;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.25 + amp * 0.75;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function renderVisualizer() {
      const enabled = state.config.visualizer.enabled && state.config.song.visualizerWithSong;
      const zones = document.querySelectorAll('.visualizer-zone');
      zones.forEach((z) => z.classList.toggle('hidden', !enabled));
      if (!enabled || !state.analyser || el.audio.paused) return;

      const type = state.config.visualizer.type;
      const color = state.config.visualizer.color;
      const canvases = [el.visualizerTop, el.visualizerBottom, el.playerViz];

      for (const canvas of canvases) {
        const ctx = resizeCanvas(canvas);
        const width = canvas.getBoundingClientRect().width;
        const height = canvas.getBoundingClientRect().height;
        if (type === 'bar') drawBar(ctx, width, height, color);
        if (type === 'wave') drawWave(ctx, width, height, color);
        if (type === 'particle') drawParticle(ctx, width, height, color);
      }

      state.visualizerRaf = requestAnimationFrame(renderVisualizer);
    }

    function fitLyric(text, fontFamily) {
      const zoneRect = el.lyricsZone.getBoundingClientRect();
      const maxW = zoneRect.width * 0.96;
      const maxH = zoneRect.height * 0.55;
      let size = Math.min(140, Math.floor(zoneRect.height * 0.18));
      el.lyricLine.style.fontFamily = fontFamily;
      el.lyricLine.textContent = text;
      el.lyricLine.style.fontSize = `${size}px`;
      while ((el.lyricLine.scrollWidth > maxW || el.lyricLine.scrollHeight > maxH) && size > 24) {
        size -= 2;
        el.lyricLine.style.fontSize = `${size}px`;
      }
    }

    function activateLyric(line) {
      const duration = Math.max(0.2, line.end - line.start);
      const fontFamily = pickFontFamily(line.fontId);
      fitLyric(line.text, fontFamily);
      el.lyricLine.style.setProperty('--lyric-duration', `${Math.max(0.15, duration * 0.92)}s`);
      el.lyricLine.className = `lyric-line ${line.effect || 'effect-fade'}`;
      state.activeLyricId = line.id;
    }

    function lyricLoop() {
      if (el.audio.paused) {
        state.lyricRaf = requestAnimationFrame(lyricLoop);
        return;
      }

      const t = el.audio.currentTime;
      const current = state.config.lyrics.find((line) => t >= line.start && t <= line.end);
      if (!current) {
        state.activeLyricId = null;
        el.lyricLine.className = 'lyric-line';
        el.lyricLine.textContent = '';
      } else if (state.activeLyricId !== current.id) {
        activateLyric(current);
      }

      if ((el.lyricLine.classList.contains('effect-audio-reactive') || (current && current.effect === 'effect-audio-reactive')) && state.analyser) {
        state.analyser.getByteFrequencyData(state.audioData);
        const avg = state.audioData.reduce((sum, n) => sum + n, 0) / state.audioData.length;
        const scale = 1 + (avg / 255) * 0.12;
        el.lyricLine.style.transform = `scale(${scale.toFixed(3)})`;
      } else {
        el.lyricLine.style.transform = '';
      }

      state.lyricRaf = requestAnimationFrame(lyricLoop);
    }

    function updateTime() {
      el.currentTime.textContent = timeLabel(el.audio.currentTime);
      el.duration.textContent = timeLabel(el.audio.duration);
      if (Number.isFinite(el.audio.duration) && el.audio.duration > 0) {
        el.seekBar.value = String((el.audio.currentTime / el.audio.duration) * 100);
      }
    }

    async function playOrPause() {
      if (!state.config.song.dataUrl) {
        alert('Admin panelden önce şarkı ekleyin.');
        return;
      }

      ensureAudioGraph();
      if (state.audioCtx.state === 'suspended') {
        await state.audioCtx.resume();
      }

      if (el.audio.paused) {
        await el.audio.play();
        el.playBtn.textContent = '⏸';
        cancelAnimationFrame(state.visualizerRaf);
        renderVisualizer();
      } else {
        el.audio.pause();
        el.playBtn.textContent = '▶';
      }
    }

    async function startRecording() {
      if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
        alert('Bu tarayıcı ekran kaydını desteklemiyor.');
        return;
      }

      try {
        if (document.fullscreenElement !== el.feedStage) {
          await el.feedStage.requestFullscreen();
        }

        state.stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 60, max: 60 },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
          audio: true,
        });

        state.chunks = [];
        state.mediaRecorder = new MediaRecorder(state.stream, {
          mimeType: 'video/webm;codecs=vp9,opus',
        });

        state.mediaRecorder.ondataavailable = (event) => {
          if (event.data?.size) state.chunks.push(event.data);
        };

        state.mediaRecorder.onstop = () => {
          const blob = new Blob(state.chunks, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          el.downloadRecord.href = url;
          el.downloadRecord.classList.remove('hidden');
          el.recordBtn.textContent = '🎥 Fullscreen Kayda Başla';
          state.stream?.getTracks().forEach((track) => track.stop());
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        };

        state.mediaRecorder.start();
        el.recordBtn.textContent = '⏹ Kaydı Durdur';

        if (!state.config.song.showPlayer) {
          el.musicPlayer.classList.add('hidden');
        }

        await playOrPause();
      } catch (error) {
        console.error(error);
        alert('Kayıt başlatılamadı. Tarayıcı izinlerini kontrol edin.');
      }
    }

    function stopRecording() {
      if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') return;
      state.mediaRecorder.stop();
      el.musicPlayer.classList.toggle('hidden', !state.config.song.showPlayer);
    }

    el.playBtn.addEventListener('click', playOrPause);
    el.audio.addEventListener('timeupdate', updateTime);
    el.audio.addEventListener('loadedmetadata', updateTime);
    el.audio.addEventListener('ended', () => {
      el.playBtn.textContent = '▶';
    });

    el.seekBar.addEventListener('input', () => {
      if (!Number.isFinite(el.audio.duration) || el.audio.duration <= 0) return;
      el.audio.currentTime = (Number(el.seekBar.value) / 100) * el.audio.duration;
      updateTime();
    });

    el.recordBtn.addEventListener('click', () => {
      if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
        stopRecording();
      } else {
        startRecording();
      }
    });

    window.addEventListener('resize', () => {
      if (state.activeLyricId) {
        const line = state.config.lyrics.find((x) => x.id === state.activeLyricId);
        if (line) activateLyric(line);
      }
    });

    setupBackground();
    setupAudio();
    lyricLoop();
  }

  function init() {
    if (page === 'admin') bindAdmin();
    if (page === 'feed') bindFeed();
  }

  init();
})();
