(() => {
  const PROVIDERS = [
    { id: 'gpt', label: '🤖 GPT', defaultEndpoint: 'https://api.openai.com/v1/chat/completions', defaultModel: 'gpt-4o-mini', apiType: 'openai' },
    { id: 'gemini', label: '✨ Gemini', defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', defaultModel: 'gemini-1.5-flash', apiType: 'gemini' },
    { id: 'claude', label: '🧠 Claude', defaultEndpoint: 'https://api.anthropic.com/v1/messages', defaultModel: 'claude-sonnet-4-5-20250929', apiType: 'anthropic' },
    { id: 'grok', label: '⚡ Grok', defaultEndpoint: 'https://api.x.ai/v1/responses', defaultModel: 'grok-4.20-reasoning', apiType: 'xai-responses' },
    { id: 'llama', label: '🦙 Llama', defaultEndpoint: 'https://api.openai.com/v1/chat/completions', defaultModel: 'meta-llama/llama-3.1-70b-instruct', apiType: 'openai' },
  ];

  const page = document.body.dataset.page;
  const STORAGE_KEY = 'aiSurvivor.config.v1';
  const FLOW_KEY = 'aiSurvivor.flow.v1';

  const state = {
    config: loadJson(STORAGE_KEY, {}),
    flow: loadJson(FLOW_KEY, {
      chats: {},
      roleByModel: {},
      enabledTargets: PROVIDERS.map((p) => p.id),
      lastVoteText: '',
      lastScoreText: '',
    }),
  };

  for (const p of PROVIDERS) {
    state.flow.chats[p.id] ||= [];
    state.flow.roleByModel[p.id] ||= 'player';
  }

  function loadJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null') || fallback;
    } catch {
      return fallback;
    }
  }

  function persistConfig() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config)); }
  function persistFlow() { localStorage.setItem(FLOW_KEY, JSON.stringify(state.flow)); }

  function byId(id) { return document.getElementById(id); }

  function cfg(providerId) {
    return state.config[providerId] || {};
  }

  function setStatus(providerId, ok, text) {
    const el = byId(`status-${providerId}`);
    if (!el) return;
    el.className = `status-pill ${ok ? 'status-ok' : 'status-bad'}`;
    el.textContent = text;
  }

  async function callProvider(provider, prompt, opts = {}) {
    const c = cfg(provider.id);
    if (!c.apiKey || !c.endpoint || !c.model) {
      throw new Error('API ayarı eksik');
    }

    const signal = opts.signal;
    if (provider.apiType === 'openai') {
      const res = await fetch(c.endpoint, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${c.apiKey}`,
        },
        body: JSON.stringify({
          model: c.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
        }),
      });
      if (!res.ok) throw new Error(await safeErr(res));
      const data = await res.json();
      return data?.choices?.[0]?.message?.content?.trim() || '(boş cevap)';
    }

    if (provider.apiType === 'gemini') {
      const url = `${c.endpoint}${c.endpoint.includes('?') ? '&' : '?'}key=${encodeURIComponent(c.apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7 },
        }),
      });
      if (!res.ok) throw new Error(await safeErr(res));
      const data = await res.json();
      return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n').trim() || '(boş cevap)';
    }

    if (provider.apiType === 'anthropic') {
      const res = await fetch(c.endpoint, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': c.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: c.model,
          max_tokens: 1200,
          temperature: 1,
          thinking: { type: 'disabled' },
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        }),
      });
      if (!res.ok) throw new Error(await safeErr(res));
      const data = await res.json();
      const textBlocks = (data?.content || []).filter((x) => x.type === 'text').map((x) => x.text);
      return textBlocks.join('\n').trim() || '(boş cevap)';
    }

    if (provider.apiType === 'xai-responses') {
      const res = await fetch(c.endpoint, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${c.apiKey}`,
        },
        body: JSON.stringify({
          model: c.model,
          input: [
            { role: 'system', content: 'You are a helpful AI assistant.' },
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (!res.ok) throw new Error(await safeErr(res));
      const data = await res.json();
      const outputText = data?.output_text
        || (data?.output || [])
          .flatMap((item) => item?.content || [])
          .filter((c) => c?.type === 'output_text' || c?.type === 'text')
          .map((c) => c?.text || '')
          .join('\n');
      return String(outputText || '').trim() || '(boş cevap)';
    }

    throw new Error('Desteklenmeyen provider tipi');
  }

  async function safeErr(res) {
    try {
      const t = await res.text();
      return `${res.status} ${res.statusText} · ${t.slice(0, 200)}`;
    } catch {
      return `${res.status} ${res.statusText}`;
    }
  }

  function addChat(modelId, role, content) {
    state.flow.chats[modelId].push({ role, content, at: Date.now() });
    persistFlow();
    renderPanels();
  }

  function selectedTargets() {
    const checks = Array.from(document.querySelectorAll('[data-target-model]'));
    return checks.filter((c) => c.checked).map((c) => c.dataset.targetModel);
  }

  async function sendMasterChat() {
    const prompt = byId('masterPrompt')?.value?.trim();
    if (!prompt) return;
    const targets = selectedTargets();
    if (!targets.length) return alert('En az bir AI seçmelisin.');

    const finalPrompt = `${prompt}\n\nKural: 100 kelimeyi aşmayacak cevap ver.`;

    for (const pid of targets) {
      const provider = PROVIDERS.find((p) => p.id === pid);
      addChat(pid, 'Game Master', prompt);
      try {
        const ans = await callProvider(provider, finalPrompt);
        addChat(pid, provider.label, ans);
      } catch (e) {
        addChat(pid, 'Sistem', `Hata: ${String(e.message || e)}`);
      }
    }
  }

  function parseOneWordVote(text, candidates) {
    const clean = String(text || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    return candidates.find((c) => c.toLowerCase() === clean) || null;
  }

  function formatVoteResult(title, ballots, totals) {
    const lines = [title, '', 'Oylar:'];
    for (const b of ballots) lines.push(`- ${b.voter} -> ${b.vote || 'GEÇERSİZ'}`);
    lines.push('', 'Toplam:');
    for (const [k, v] of Object.entries(totals)) lines.push(`- ${k}: ${v}`);
    return lines.join('\n');
  }

  async function runVote(mode) {
    const q = byId('voteQuestion')?.value?.trim();
    const candidates = Array.from(document.querySelectorAll('[data-vote-candidate]'))
      .filter((x) => x.checked)
      .map((x) => x.dataset.voteCandidate);

    if (!q || !candidates.length) return alert('Soru ve en az bir aday gerekli.');

    const targets = selectedTargets();
    if (!targets.length) return alert('Oy kullanacak en az bir AI seç.');

    const ballots = [];
    const totals = Object.fromEntries(candidates.map((c) => [c, 0]));

    for (const pid of targets) {
      const provider = PROVIDERS.find((p) => p.id === pid);
      const rule = 'Kural: sadece tek kelime ile cevap ver.';
      const selfRule = mode === 'selection'
        ? `Ek kural: Kendine oy VERME. Geçerli adaylar: ${candidates.join(', ')}.`
        : `Ek kural: Kendine oy verebilirsin. Geçerli adaylar: ${candidates.join(', ')}.`;
      const prompt = `${q}\nAdaylar: ${candidates.join(', ')}\n${selfRule}\n${rule}`;

      addChat(pid, 'Game Master', `[${mode}] ${q}`);
      try {
        const ans = await callProvider(provider, prompt);
        addChat(pid, provider.label, ans);

        let vote = parseOneWordVote(ans, candidates);
        if (mode === 'selection' && vote === pid) vote = null;
        if (vote) totals[vote] += 1;
        ballots.push({ voter: pid, vote });
      } catch (e) {
        addChat(pid, 'Sistem', `Hata: ${String(e.message || e)}`);
        ballots.push({ voter: pid, vote: null });
      }
    }

    const title = mode === 'elimination' ? 'Eleme Oylaması Sonucu' : 'Belirleme Oylaması Sonucu';
    state.flow.lastVoteText = formatVoteResult(title, ballots, totals);
    persistFlow();
    byId('lastVoteResult').textContent = state.flow.lastVoteText;
  }

  function parseScoreAnswer(text, candidates, allowedRange, allowedList) {
    const out = {};
    const src = String(text || '').toLowerCase();
    for (const c of candidates) {
      const rx = new RegExp(`${c.toLowerCase()}\\s*[:=-]\\s*(-?\\d+)`);
      const m = src.match(rx);
      if (!m) continue;
      const n = Number(m[1]);
      const inRange = n >= allowedRange.min && n <= allowedRange.max;
      const inList = !allowedList.length || allowedList.includes(n);
      if (inRange && inList) out[c] = n;
    }
    return out;
  }

  async function runScoring() {
    const q = byId('scoreQuestion')?.value?.trim();
    const candidates = Array.from(document.querySelectorAll('[data-score-candidate]'))
      .filter((x) => x.checked)
      .map((x) => x.dataset.scoreCandidate);
    if (!q || !candidates.length) return alert('Puanlama için soru ve adaylar gerekli.');

    const min = Number(byId('minScore').value || 1);
    const max = Number(byId('maxScore').value || 10);
    const allowedList = (byId('fixedScores').value || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));

    const totals = Object.fromEntries(candidates.map((c) => [c, 0]));
    const lines = ['Puanlama Sonucu', ''];

    for (const pid of selectedTargets()) {
      const provider = PROVIDERS.find((p) => p.id === pid);
      const otherCandidates = candidates.filter((c) => c !== pid);
      const prompt = `${q}\nAdaylar: ${otherCandidates.join(', ')}\nPuan aralığı: ${min}-${max}. ${allowedList.length ? `Sadece şu puanlar: ${allowedList.join(', ')}` : ''}\nKural: sadece kime kaç puan verdiğini belirt , 10 kelimeyi geçme.`;
      addChat(pid, 'Game Master', `[puanlama] ${q}`);

      try {
        const ans = await callProvider(provider, prompt);
        addChat(pid, provider.label, ans);
        const parsed = parseScoreAnswer(ans, otherCandidates, { min, max }, allowedList);
        lines.push(`${pid}: ${Object.entries(parsed).map(([k, v]) => `${k}:${v}`).join(' | ') || 'geçersiz/boş'}`);
        for (const [k, v] of Object.entries(parsed)) totals[k] += v;
      } catch (e) {
        addChat(pid, 'Sistem', `Hata: ${String(e.message || e)}`);
        lines.push(`${pid}: hata`);
      }
    }

    lines.push('', 'Toplamlar:');
    for (const [k, v] of Object.entries(totals)) lines.push(`- ${k}: ${v}`);
    state.flow.lastScoreText = lines.join('\n');
    persistFlow();
    byId('lastScoreResult').textContent = state.flow.lastScoreText;
  }

  function renderAdmin() {
    const wrap = byId('providerConfig');
    if (!wrap) return;
    wrap.innerHTML = PROVIDERS.map((p) => {
      const c = cfg(p.id);
      return `
        <article class="provider-card">
          <h3>${p.label}</h3>
          <label>API Key <input type="password" id="key-${p.id}" value="${escapeHtml(c.apiKey || '')}" placeholder="sk-..." /></label>
          <label>Endpoint <input type="text" id="endpoint-${p.id}" value="${escapeHtml(c.endpoint || p.defaultEndpoint)}" /></label>
          <label>Model <input type="text" id="model-${p.id}" value="${escapeHtml(c.model || p.defaultModel)}" /></label>
          <div class="toolbar">
            <button data-test="${p.id}">Bağlantıyı Test Et</button>
            <span id="status-${p.id}" class="status-pill">Bekliyor</span>
          </div>
        </article>`;
    }).join('');

    wrap.addEventListener('input', (e) => {
      const id = (e.target.id || '').split('-')[1];
      if (!id) return;
      const item = PROVIDERS.find((x) => x.id === id);
      state.config[id] = {
        apiKey: byId(`key-${id}`).value.trim(),
        endpoint: byId(`endpoint-${id}`).value.trim() || item.defaultEndpoint,
        model: byId(`model-${id}`).value.trim() || item.defaultModel,
      };
      persistConfig();
      if (e.target.id.startsWith('key-') && state.config[id].apiKey) autoConnect(id);
    });

    wrap.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-test]');
      if (!btn) return;
      autoConnect(btn.dataset.test);
    });

    byId('saveConfigBtn').addEventListener('click', () => {
      for (const p of PROVIDERS) {
        state.config[p.id] = {
          apiKey: byId(`key-${p.id}`).value.trim(),
          endpoint: byId(`endpoint-${p.id}`).value.trim() || p.defaultEndpoint,
          model: byId(`model-${p.id}`).value.trim() || p.defaultModel,
        };
      }
      persistConfig();
      alert('Ayarlar kaydedildi.');
    });

    byId('clearConfigBtn').addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });
  }

  async function autoConnect(providerId) {
    const provider = PROVIDERS.find((p) => p.id === providerId);
    setStatus(providerId, false, 'Bağlanıyor...');
    try {
      await callProvider(provider, 'Bağlantı testi: sadece OK yaz.');
      setStatus(providerId, true, 'Bağlı');
    } catch (e) {
      const msg = String(e?.message || e || 'Bilinmeyen hata');
      const pretty = msg.includes('Failed to fetch')
        ? 'Hata: Failed to fetch (muhtemel CORS)'
        : `Hata: ${msg.slice(0, 42)}`;
      setStatus(providerId, false, pretty);
      console.error(providerId, e);
    }
  }

  function renderTargetCheckboxes(containerId, dataAttr) {
    const wrap = byId(containerId);
    if (!wrap) return;
    wrap.innerHTML = PROVIDERS.map((p) => `
      <label class="target-chip">
        <input type="checkbox" data-${dataAttr}="${p.id}" checked /> ${p.label}
      </label>`).join('');
  }

  function renderPanels() {
    const wrap = byId('modelPanels');
    if (!wrap) return;
    wrap.innerHTML = PROVIDERS.map((p) => {
      const role = state.flow.roleByModel[p.id] || 'player';
      const logs = state.flow.chats[p.id]
        .map((m) => `<div class="msg"><div class="role">${escapeHtml(m.role)}</div>${escapeHtml(m.content)}</div>`)
        .join('');
      return `<article class="model-panel ${role}">
        <div class="model-head">
          <strong>${p.label}</strong>
          <span>${role === 'player' ? '🟢 Oyuncu' : '🔴 Jüri'}</span>
        </div>
        <div class="toolbar">
          <button data-eliminate="${p.id}">Ele</button>
          <button data-rejoin="${p.id}">Yeniden Oyuna Al</button>
        </div>
        <div class="chat-log" id="log-${p.id}">${logs || '<span class="muted">Henüz mesaj yok.</span>'}</div>
      </article>`;
    }).join('');

    wrap.querySelectorAll('[data-eliminate]').forEach((b) => b.addEventListener('click', () => {
      state.flow.roleByModel[b.dataset.eliminate] = 'jury';
      persistFlow();
      renderPanels();
    }));

    wrap.querySelectorAll('[data-rejoin]').forEach((b) => b.addEventListener('click', () => {
      state.flow.roleByModel[b.dataset.rejoin] = 'player';
      persistFlow();
      renderPanels();
    }));
  }

  function renderTaskOptions() {
    const mode = byId('taskType').value;
    const wrap = byId('taskOptions');
    if (mode === 'chat') {
      wrap.innerHTML = '<p class="muted">Normal chat gönderilecek.</p>';
      return;
    }
    if (mode === 'elimination' || mode === 'selection') {
      wrap.innerHTML = `<label>Oylama Sorusu <input id="voteQuestion" type="text" placeholder="Hangi AI elensin?" /></label>`;
      return;
    }
    wrap.innerHTML = `
      <div class="task-options">
        <label>Min Puan <input id="minScore" type="number" value="1" /></label>
        <label>Max Puan <input id="maxScore" type="number" value="10" /></label>
        <label>Sabit Puanlar (örn: 1,3,5) <input id="fixedScores" type="text" placeholder="opsiyonel" /></label>
      </div>`;
  }

  async function sendFromDock() {
    const mode = byId('taskType').value;
    if (mode === 'chat') {
      await sendMasterChat();
      return;
    }
    if (mode === 'elimination' || mode === 'selection') {
      const q = byId('voteQuestion')?.value?.trim();
      if (!q) {
        const fallback = byId('masterPrompt')?.value?.trim();
        if (fallback) byId('voteQuestion').value = fallback;
      }
      await runVote(mode);
      return;
    }

    const q = byId('masterPrompt')?.value?.trim();
    let hidden = byId('scoreQuestion');
    if (!hidden) {
      hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.id = 'scoreQuestion';
      document.body.appendChild(hidden);
    }
    hidden.value = q || '';
    await runScoring();
  }

  function renderFlow() {
    renderTargetCheckboxes('targetCheckboxes', 'target-model');
    renderTargetCheckboxes('voteCandidates', 'vote-candidate');
    renderTargetCheckboxes('scoreCandidates', 'score-candidate');
    renderPanels();
    byId('lastVoteResult').textContent = state.flow.lastVoteText || 'Henüz oylama yok.';
    byId('lastScoreResult').textContent = state.flow.lastScoreText || 'Henüz puanlama yok.';

    renderTaskOptions();
    byId('taskType').addEventListener('change', renderTaskOptions);
    byId('toggleTaskMenuBtn').addEventListener('click', () => {
      byId('taskMenu').classList.toggle('hidden');
    });
    byId('sendTaskBtn').addEventListener('click', sendFromDock);

    byId('clearChatsBtn').addEventListener('click', () => {
      for (const p of PROVIDERS) state.flow.chats[p.id] = [];
      persistFlow();
      renderPanels();
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  if (page === 'admin') renderAdmin();
  if (page === 'feed') renderFlow();
})();
