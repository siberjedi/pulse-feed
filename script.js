(() => {
  const STORAGE_KEY = 'pulse.lyricVideoConfig.v1';
  const EFFECTS = [
    ['effect-fade', 'Fade In / Fade Out'], ['effect-slide-up', 'Slide Up'], ['effect-slide-left', 'Slide From Left'],
    ['effect-blur', 'Blur’dan Netleşme'], ['effect-opacity-pulse', 'Opacity Pulse'], ['effect-glitch', 'Glitch Effect'],
    ['effect-shake', 'Shake / Impact'], ['effect-letter-stagger', 'Letter Stagger'], ['effect-distortion-flash', 'Distortion Flash'],
    ['effect-typewriter', 'Typewriter Effect'], ['effect-mask-reveal', 'Mask Reveal'], ['effect-scale-impact', 'Scale Impact'],
    ['effect-word-highlighting', 'Word Highlighting'], ['effect-audio-reactive', 'Audio Reactive Text'],
    ['effect-3d-perspective', '3D Perspective Text'], ['effect-particle-text', 'Particle Text'],
  ];

  const defaultConfig = {
    song: { title: '', dataUrl: '', fileName: '', size: 0, showPlayer: true, visualizerWithSong: false },
    visualizer: { enabled: false, type: 'bar', color: '#5f87ff' },
    background: { mode: 'loop', color: '#040812', items: [] },
    lyrics: [],
    fonts: [],
  };

  const page = document.body.dataset.page;
  const state = {
    config: loadConfig(), audioCtx: null, analyser: null, audioData: new Uint8Array(256),
    activeLyricId: null, visualizerRaf: 0, currentBgIndex: 0, mediaRecorder: null, chunks: [], stream: null,
  };

  function loadConfig() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw) return structuredClone(defaultConfig);
      return {
        ...structuredClone(defaultConfig), ...raw,
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

  function saveConfig() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config)); }
  function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
  function formatBytes(bytes) { if (!bytes) return '0 KB'; const u=['B','KB','MB','GB']; let v=bytes,i=0; while(v>=1024&&i<u.length-1){v/=1024;i++;} return `${v.toFixed(1)} ${u[i]}`; }
  function timeLabel(s){ if(!Number.isFinite(s)) return '0:00'; return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`; }

  function readAsDataUrl(file){ return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(String(r.result)); r.onerror=reject; r.readAsDataURL(file); }); }

  function parseLyrics(raw) {
    return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const [start, end, ...textParts] = line.split('|');
      const text = textParts.join('|').trim();
      const s = Number(start); const e = Number(end);
      if (!Number.isFinite(s) || !Number.isFinite(e) || !text) return null;
      return { id: uid(), start: s, end: e, text, effect: 'effect-fade', fontId: '' };
    }).filter(Boolean).sort((a, b) => a.start - b.start);
  }

  function effectOptions(selected) { return EFFECTS.map(([v,l])=>`<option value="${v}" ${v===selected?'selected':''}>${l}</option>`).join(''); }
  function fontOptions(selected, includeEmpty = true) {
    const out = includeEmpty ? ['<option value="">Varsayılan</option>'] : [];
    for (const f of state.config.fonts) out.push(`<option value="${f.id}" ${selected===f.id?'selected':''}>${f.name}</option>`);
    return out.join('');
  }

  function mountFontFaces() {
    let styleEl = document.getElementById('dynamicFontFaces');
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'dynamicFontFaces'; document.head.appendChild(styleEl); }
    styleEl.textContent = state.config.fonts.map((font) => `@font-face { font-family:'${font.family}'; src:url('${font.dataUrl}'); font-display:swap; }`).join('\n');
  }

  function bindAdmin() {
    const el = {
      songFile: document.getElementById('songFile'), songTitle: document.getElementById('songTitle'),
      showPlayerToggle: document.getElementById('showPlayerToggle'), visualizerWithSongToggle: document.getElementById('visualizerWithSongToggle'),
      songInfo: document.getElementById('songInfo'), visualizerEnabled: document.getElementById('visualizerEnabled'),
      visualizerType: document.getElementById('visualizerType'), visualizerColor: document.getElementById('visualizerColor'),
      backgroundFiles: document.getElementById('backgroundFiles'), backgroundMode: document.getElementById('backgroundMode'),
      backgroundColor: document.getElementById('backgroundColor'), backgroundList: document.getElementById('backgroundList'),
      lyricsInput: document.getElementById('lyricsInput'), parseLyricsBtn: document.getElementById('parseLyricsBtn'),
      applyAllEffect: document.getElementById('applyAllEffect'), applyAllFont: document.getElementById('applyAllFont'),
      lyricsTable: document.getElementById('lyricsTable'), fontFiles: document.getElementById('fontFiles'),
      fontPreviewList: document.getElementById('fontPreviewList'), saveAllBtn: document.getElementById('saveAllBtn'), saveStatus: document.getElementById('saveStatus'),
    };

    function markSaved(message = 'Kaydedildi') {
      saveConfig();
      el.saveStatus.textContent = `${message} • ${new Date().toLocaleTimeString('tr-TR')}`;
      clearTimeout(markSaved._t);
      markSaved._t = setTimeout(() => { el.saveStatus.textContent = ''; }, 1600);
    }

    function renderSong(){
      const song = state.config.song;
      el.songTitle.value = song.title || '';
      el.showPlayerToggle.checked = !!song.showPlayer;
      el.visualizerWithSongToggle.checked = !!song.visualizerWithSong;
      el.songInfo.textContent = song.dataUrl ? `${song.fileName || 'Şarkı'} yüklü • ${formatBytes(song.size)}` : 'Henüz şarkı yüklenmedi.';
    }

    function renderVisualizer(){
      el.visualizerEnabled.checked = !!state.config.visualizer.enabled;
      el.visualizerType.value = state.config.visualizer.type;
      el.visualizerColor.value = state.config.visualizer.color;
    }

    function renderBackground(){
      el.backgroundMode.value = state.config.background.mode;
      el.backgroundColor.value = state.config.background.color;
      if (!state.config.background.items.length) { el.backgroundList.innerHTML = '<span class="hint">Video/GIF eklenmedi. Sadece renk kullanılacak.</span>'; return; }
      el.backgroundList.innerHTML = state.config.background.items.map((i,idx)=>`<div class="manage-row">${idx+1}. ${i.fileName} (${i.kind}) <button type="button" data-remove-bg="${i.id}">Sil</button></div>`).join('');
    }

    function renderLyrics(){
      el.applyAllEffect.innerHTML = `<option value="">Seçin</option>${effectOptions('')}`;
      el.applyAllFont.innerHTML = `<option value="">Seçin</option>${fontOptions('', false)}`;
      if (!state.config.lyrics.length) { el.lyricsTable.innerHTML = '<p class="hint">Lyric yok. Bu durumda feed müzik/arka plan ile çalışır.</p>'; return; }
      el.lyricsTable.innerHTML = state.config.lyrics.map((line)=>`
      <article class="lyric-item">
        <div class="lyric-item-top"><strong>[${line.start.toFixed(3)}]</strong><strong>[${line.end.toFixed(3)}]</strong><span>${line.text}</span><button type="button" data-edit-lyric="${line.id}">Edit</button></div>
        <div class="grid two"><label>Effect<select data-line-effect="${line.id}">${effectOptions(line.effect)}</select></label><label>Font<select data-line-font="${line.id}">${fontOptions(line.fontId || '')}</select></label></div>
      </article>`).join('');
    }

    function renderFonts(){
      if (!state.config.fonts.length) { el.fontPreviewList.innerHTML = '<p class="hint">Henüz font yüklenmedi.</p>'; return; }
      el.fontPreviewList.innerHTML = state.config.fonts.map((f)=>`<article class="font-card"><strong>${f.name}</strong><div class="font-sample" style="font-family:'${f.family}'">Pulse Feed Lyric Preview</div><button type="button" data-remove-font="${f.id}">Kaldır</button></article>`).join('');
    }

    function renderAll(){ mountFontFaces(); renderSong(); renderVisualizer(); renderBackground(); renderLyrics(); renderFonts(); }

    el.songFile.addEventListener('change', async () => {
      const file = el.songFile.files?.[0]; if (!file) return;
      if (!(/\.mp3$|\.wav$/i).test(file.name)) { alert('Sadece .mp3 ve .wav desteklenir.'); el.songFile.value = ''; return; }
      state.config.song = { ...state.config.song, dataUrl: await readAsDataUrl(file), fileName: file.name, size: file.size };
      renderSong(); markSaved('Şarkı kaydedildi');
    });
    el.songTitle.addEventListener('input', () => { state.config.song.title = el.songTitle.value.trim(); markSaved('Şarkı adı kaydedildi'); });
    el.showPlayerToggle.addEventListener('change', () => { state.config.song.showPlayer = el.showPlayerToggle.checked; markSaved('Player tercihi kaydedildi'); });
    el.visualizerWithSongToggle.addEventListener('change', () => { state.config.song.visualizerWithSong = el.visualizerWithSongToggle.checked; markSaved('Visualizer şarkı bağlantısı kaydedildi'); });

    el.visualizerEnabled.addEventListener('change', () => { state.config.visualizer.enabled = el.visualizerEnabled.checked; markSaved('Visualizer ayarı kaydedildi'); });
    el.visualizerType.addEventListener('change', () => { state.config.visualizer.type = el.visualizerType.value; markSaved('Visualizer türü kaydedildi'); });
    el.visualizerColor.addEventListener('input', () => { state.config.visualizer.color = el.visualizerColor.value; markSaved('Visualizer rengi kaydedildi'); });

    el.backgroundMode.addEventListener('change', () => { state.config.background.mode = el.backgroundMode.value; renderBackground(); markSaved('Arkaplan modu kaydedildi'); });
    el.backgroundColor.addEventListener('input', () => { state.config.background.color = el.backgroundColor.value; markSaved('Arkaplan rengi kaydedildi'); });
    el.backgroundFiles.addEventListener('change', async () => {
      const files = Array.from(el.backgroundFiles.files || []); if (!files.length) return;
      const next = [...state.config.background.items];
      for (const file of files) {
        if (!(/\.(gif|mp4|mkv|webm)$/i).test(file.name)) continue;
        next.push({ id: uid(), fileName: file.name, kind: /\.gif$/i.test(file.name) ? 'gif' : 'video', dataUrl: await readAsDataUrl(file) });
      }
      state.config.background.items = next;
      renderBackground(); markSaved('Arkaplan dosyaları kaydedildi');
    });
    el.backgroundList.addEventListener('click', (e)=>{
      const btn = e.target.closest('[data-remove-bg]'); if (!btn) return;
      state.config.background.items = state.config.background.items.filter((x)=>x.id!==btn.getAttribute('data-remove-bg'));
      renderBackground(); markSaved('Arkaplan dosyası silindi');
    });

    el.parseLyricsBtn.addEventListener('click', () => {
      const parsed = parseLyrics(el.lyricsInput.value);
      if (!parsed.length) { alert('Geçerli lyric satırı bulunamadı.'); return; }
      state.config.lyrics = parsed;
      renderLyrics(); markSaved('Lyric listesi kaydedildi');
    });

    el.lyricsTable.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-edit-lyric]'); if (!editBtn) return;
      const row = state.config.lyrics.find((x)=>x.id===editBtn.getAttribute('data-edit-lyric')); if (!row) return;
      const next = prompt('Yeni lyric', row.text); if (next === null) return;
      row.text = next.trim() || row.text;
      renderLyrics(); markSaved('Lyric güncellendi');
    });

    el.lyricsTable.addEventListener('change', (e) => {
      const effectSel = e.target.closest('[data-line-effect]');
      if (effectSel) { const row = state.config.lyrics.find((x)=>x.id===effectSel.getAttribute('data-line-effect')); if (row) { row.effect = effectSel.value; markSaved('Lyric efekti kaydedildi'); } }
      const fontSel = e.target.closest('[data-line-font]');
      if (fontSel) { const row = state.config.lyrics.find((x)=>x.id===fontSel.getAttribute('data-line-font')); if (row) { row.fontId = fontSel.value; markSaved('Lyric fontu kaydedildi'); } }
    });

    el.applyAllEffect.addEventListener('change', ()=>{ if(!el.applyAllEffect.value) return; state.config.lyrics=state.config.lyrics.map((x)=>({...x,effect:el.applyAllEffect.value})); renderLyrics(); markSaved('Tüm lyric efektleri kaydedildi'); });
    el.applyAllFont.addEventListener('change', ()=>{ state.config.lyrics=state.config.lyrics.map((x)=>({...x,fontId:el.applyAllFont.value})); renderLyrics(); markSaved('Tüm lyric fontları kaydedildi'); });

    el.fontFiles.addEventListener('change', async ()=>{
      const files = Array.from(el.fontFiles.files || []); if (!files.length) return;
      for (const file of files) {
        if (!(/\.(woff2?|ttf|otf)$/i).test(file.name)) continue;
        state.config.fonts.push({ id: uid(), name: file.name.replace(/\.[^.]+$/, ''), family: `upload-${uid()}`, dataUrl: await readAsDataUrl(file) });
      }
      mountFontFaces(); renderFonts(); renderLyrics(); markSaved('Fontlar kaydedildi');
    });

    el.fontPreviewList.addEventListener('click', (e)=>{
      const btn = e.target.closest('[data-remove-font]'); if (!btn) return;
      const id = btn.getAttribute('data-remove-font');
      state.config.fonts = state.config.fonts.filter((x)=>x.id!==id);
      state.config.lyrics = state.config.lyrics.map((x)=>({...x, fontId: x.fontId === id ? '' : x.fontId}));
      mountFontFaces(); renderFonts(); renderLyrics(); markSaved('Font kaldırıldı');
    });

    document.querySelectorAll('[data-save-section]').forEach((btn)=>btn.addEventListener('click', ()=>markSaved(`${btn.getAttribute('data-save-section')} ayarları kaydedildi`)));
    el.saveAllBtn.addEventListener('click', ()=>markSaved('Tüm ayarlar kaydedildi'));

    renderAll();
  }

  function bindFeed() {
    mountFontFaces();
    const el = {
      feedStage: document.getElementById('feedStage'), backgroundLayer: document.getElementById('backgroundLayer'),
      lyricsZone: document.getElementById('lyricsZone'), lyricLine: document.getElementById('lyricLine'), musicPlayer: document.getElementById('musicPlayer'),
      playerSongName: document.getElementById('playerSongName'), playBtn: document.getElementById('playBtn'), stagePlayBtn: document.getElementById('stagePlayBtn'),
      seekBar: document.getElementById('seekBar'), currentTime: document.getElementById('currentTime'), duration: document.getElementById('duration'), audio: document.getElementById('audio'),
      recordBtn: document.getElementById('recordBtn'), downloadRecord: document.getElementById('downloadRecord'), visualizerTop: document.getElementById('visualizerTop'), visualizerBottom: document.getElementById('visualizerBottom'), playerViz: document.getElementById('playerViz'),
    };

    const zones = document.querySelectorAll('.visualizer-zone');

    function resizeCanvas(canvas){ const r=canvas.getBoundingClientRect(); const dpr=Math.max(1,Math.min(window.devicePixelRatio||1,2)); canvas.width=Math.floor(r.width*dpr); canvas.height=Math.floor(r.height*dpr); const ctx=canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); return {ctx,w:r.width,h:r.height}; }
    function pickFont(fontId){ const f=state.config.fonts.find((x)=>x.id===fontId); return f ? `'${f.family}', Inter, sans-serif` : 'Inter, sans-serif'; }

    function applyModeVisibility() {
      const vizEnabled = !!(state.config.visualizer.enabled && state.config.song.visualizerWithSong);
      zones.forEach((z) => z.classList.toggle('hidden', !vizEnabled));
      el.musicPlayer.classList.toggle('hidden', !state.config.song.showPlayer);
    }

    function setupBackground(){
      el.backgroundLayer.innerHTML=''; el.feedStage.style.background=state.config.background.color||'#040812';
      const items = state.config.background.items || []; if(!items.length) return;
      const mode = state.config.background.mode;
      const mount = (index) => {
        const item = items[index % items.length];
        el.backgroundLayer.innerHTML='';
        if(item.kind==='gif'){ const img=document.createElement('img'); img.src=item.dataUrl; img.alt='bg'; el.backgroundLayer.appendChild(img); if(mode==='list'&&items.length>1){ setTimeout(()=>mount((index+1)%items.length),8000);} return; }
        const video=document.createElement('video'); video.src=item.dataUrl; video.autoplay=true; video.muted=true; video.playsInline=true; video.loop=mode==='loop'; video.onended=()=>{ if(mode==='list') mount((index+1)%items.length); }; el.backgroundLayer.appendChild(video);
      };
      mount(0);
    }

    function setupAudio(){
      const song = state.config.song;
      if (!song.dataUrl) {
        el.playerSongName.textContent = 'Şarkı yüklenmedi';
        el.stagePlayBtn.disabled = true;
        el.stagePlayBtn.textContent = 'Şarkı yok';
        return;
      }
      el.audio.src = song.dataUrl;
      el.playerSongName.textContent = song.title || song.fileName || 'Yüklenen şarkı';
      el.stagePlayBtn.disabled = false;
    }

    function ensureAudioGraph(){ if(state.audioCtx) return; state.audioCtx=new AudioContext(); const source=state.audioCtx.createMediaElementSource(el.audio); state.analyser=state.audioCtx.createAnalyser(); state.analyser.fftSize=512; source.connect(state.analyser); state.analyser.connect(state.audioCtx.destination); state.audioData=new Uint8Array(state.analyser.frequencyBinCount); }
    function drawBar(ctx,w,h,color){ ctx.clearRect(0,0,w,h); if(!state.analyser)return; state.analyser.getByteFrequencyData(state.audioData); const bars=48,bw=w/bars,c=(bars-1)/2; ctx.fillStyle=color; for(let i=0;i<bars;i++){const idx=Math.floor((i/bars)*state.audioData.length);const amp=state.audioData[idx]/255;const d=1-Math.abs(i-c)/c;const bh=Math.max(3,amp*h*(0.2+d*0.9));ctx.fillRect(i*bw+1,(h-bh)/2,Math.max(2,bw-2),bh);} }
    function drawWave(ctx,w,h,color){ ctx.clearRect(0,0,w,h); if(!state.analyser)return; state.analyser.getByteTimeDomainData(state.audioData); ctx.strokeStyle=color; ctx.lineWidth=3; ctx.beginPath(); for(let i=0;i<state.audioData.length;i++){const x=(i/(state.audioData.length-1))*w; const y=(state.audioData[i]/255)*h; if(!i)ctx.moveTo(x,y); else ctx.lineTo(x,y);} ctx.stroke(); }
    function drawParticle(ctx,w,h,color){ ctx.clearRect(0,0,w,h); if(!state.analyser)return; state.analyser.getByteFrequencyData(state.audioData); const cy=h/2; for(let i=0;i<130;i++){const a=state.audioData[i%state.audioData.length]/255; const x=(i/130)*w; const y=cy+(Math.random()-0.5)*a*h*0.5; ctx.globalAlpha=0.25+a*0.75; ctx.fillStyle=color; ctx.beginPath(); ctx.arc(x,y,1+a*4,0,Math.PI*2); ctx.fill();} ctx.globalAlpha=1; }

    function renderVisualizer(){
      const enabled = state.config.visualizer.enabled && state.config.song.visualizerWithSong && !el.audio.paused && !!state.analyser;
      if (!enabled) return;
      for (const canvas of [el.visualizerTop, el.visualizerBottom, el.playerViz]) {
        const { ctx, w, h } = resizeCanvas(canvas);
        if (state.config.visualizer.type === 'bar') drawBar(ctx,w,h,state.config.visualizer.color);
        if (state.config.visualizer.type === 'wave') drawWave(ctx,w,h,state.config.visualizer.color);
        if (state.config.visualizer.type === 'particle') drawParticle(ctx,w,h,state.config.visualizer.color);
      }
      state.visualizerRaf = requestAnimationFrame(renderVisualizer);
    }

    function fitLyric(text, fontFamily){
      const z = el.lyricsZone.getBoundingClientRect(); const maxW=z.width*0.96, maxH=z.height*0.55;
      let size = Math.min(140, Math.floor(z.height*0.18));
      el.lyricLine.style.fontFamily=fontFamily; el.lyricLine.textContent=text; el.lyricLine.style.fontSize=`${size}px`;
      while((el.lyricLine.scrollWidth>maxW || el.lyricLine.scrollHeight>maxH) && size>24){ size-=2; el.lyricLine.style.fontSize=`${size}px`; }
    }

    function activateLyric(line){
      fitLyric(line.text, pickFont(line.fontId));
      const d = Math.max(0.2, line.end-line.start);
      el.lyricLine.style.setProperty('--lyric-duration', `${Math.max(0.15,d*0.92)}s`);
      el.lyricLine.className = `lyric-line ${line.effect || 'effect-fade'}`;
      state.activeLyricId = line.id;
    }

    function lyricLoop(){
      const lines = state.config.lyrics;
      if (!lines.length || el.audio.paused) { requestAnimationFrame(lyricLoop); return; }
      const t = el.audio.currentTime;
      const current = lines.find((l)=>t>=l.start && t<=l.end);
      if (!current) { state.activeLyricId = null; el.lyricLine.className='lyric-line'; el.lyricLine.textContent=''; }
      else if (state.activeLyricId !== current.id) activateLyric(current);
      if (current && current.effect === 'effect-audio-reactive' && state.analyser) {
        state.analyser.getByteFrequencyData(state.audioData);
        const avg = state.audioData.reduce((s,n)=>s+n,0)/state.audioData.length;
        el.lyricLine.style.transform = `scale(${(1 + (avg/255)*0.12).toFixed(3)})`;
      } else {
        el.lyricLine.style.transform = '';
      }
      requestAnimationFrame(lyricLoop);
    }

    function updateTime(){ el.currentTime.textContent=timeLabel(el.audio.currentTime); el.duration.textContent=timeLabel(el.audio.duration); if(Number.isFinite(el.audio.duration)&&el.audio.duration>0){el.seekBar.value=String((el.audio.currentTime/el.audio.duration)*100);} }

    async function togglePlay(){
      if (!state.config.song.dataUrl) { alert('Admin panelde önce şarkı ekleyin.'); return; }
      ensureAudioGraph(); if(state.audioCtx.state==='suspended') await state.audioCtx.resume();
      if(el.audio.paused){ await el.audio.play(); el.playBtn.textContent='⏸'; el.stagePlayBtn.textContent='⏸ Müziği Duraklat'; cancelAnimationFrame(state.visualizerRaf); renderVisualizer(); }
      else { el.audio.pause(); el.playBtn.textContent='▶'; el.stagePlayBtn.textContent='▶ Müziği Başlat'; }
    }

    async function startRecording() {
      if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) { alert('Bu tarayıcı ekran kaydını desteklemiyor.'); return; }
      try {
        if (document.fullscreenElement !== el.feedStage) await el.feedStage.requestFullscreen();
        state.stream = await navigator.mediaDevices.getDisplayMedia({ video:{ frameRate:{ideal:60,max:60}, width:{ideal:3840}, height:{ideal:2160} }, audio:true });
        state.chunks = [];
        state.mediaRecorder = new MediaRecorder(state.stream, { mimeType: 'video/webm;codecs=vp9,opus' });
        state.mediaRecorder.ondataavailable = (ev)=>{ if(ev.data?.size) state.chunks.push(ev.data); };
        state.mediaRecorder.onstop = ()=>{
          const blob = new Blob(state.chunks, { type:'video/webm' });
          el.downloadRecord.href = URL.createObjectURL(blob); el.downloadRecord.classList.remove('hidden');
          el.recordBtn.textContent = '🎥 Fullscreen Kayda Başla';
          state.stream?.getTracks().forEach((t)=>t.stop()); if (document.fullscreenElement) document.exitFullscreen().catch(()=>{});
          applyModeVisibility();
        };
        state.mediaRecorder.start();
        el.recordBtn.textContent = '⏹ Kaydı Durdur';
        if (!state.config.song.showPlayer) el.musicPlayer.classList.add('hidden');
        if (el.audio.paused) await togglePlay();
      } catch { alert('Kayıt başlatılamadı. İzinleri kontrol edin.'); }
    }

    function stopRecording(){ if(!state.mediaRecorder||state.mediaRecorder.state==='inactive') return; state.mediaRecorder.stop(); }

    el.playBtn.addEventListener('click', togglePlay);
    el.stagePlayBtn.addEventListener('click', togglePlay);
    el.audio.addEventListener('timeupdate', updateTime);
    el.audio.addEventListener('loadedmetadata', updateTime);
    el.audio.addEventListener('ended', ()=>{ el.playBtn.textContent='▶'; el.stagePlayBtn.textContent='▶ Müziği Başlat'; });
    el.seekBar.addEventListener('input', ()=>{ if(Number.isFinite(el.audio.duration)&&el.audio.duration>0){ el.audio.currentTime=(Number(el.seekBar.value)/100)*el.audio.duration; updateTime(); } });
    el.recordBtn.addEventListener('click', ()=>{ if(state.mediaRecorder&&state.mediaRecorder.state==='recording') stopRecording(); else startRecording(); });

    applyModeVisibility();
    setupBackground();
    setupAudio();
    lyricLoop();
  }

  function init(){ if(page==='admin') bindAdmin(); if(page==='feed') bindFeed(); }
  init();
})();
