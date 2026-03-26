const STORAGE_KEY = 'santiyeConfig.v1';
const DB_NAME = 'santiye_game_db';
const STORE_NAME = 'kv';
const DB_KEY = 'config';

const defaultConfig = {
  eventTitle: 'Şantiye Patronu',
  introImage: 'assets/Giriş.JPG',
  tasks: [
    { id: 1, name: 'Çimento Krizi', load: 150, reward: 80, image: 'assets/Görev1.JPG' },
    { id: 2, name: 'Patronun Kasası', load: 200, reward: 90, image: 'assets/Görev2.JPG' },
  ],
  workers: [{ id: 'w1', name: 'Örnek İşçi', power: 25, cost: 0, image: '' }],
  machines: [{ id: 'm1', name: 'Örnek Makine', gain: 4, cost: 100, image: '' }],
  chanceCards: [{ id: 'c1', name: 'Örnek Şans', image: '', effects: [] }],
};

let config = structuredClone(defaultConfig);
let dirty = false;
const $ = (id) => document.getElementById(id);

function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function load() {
  try {
    const fromDb = await idbGet(DB_KEY);
    if (fromDb) return { ...defaultConfig, ...fromDb };
  } catch {}
  try {
    return { ...defaultConfig, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return structuredClone(defaultConfig);
  }
}

function markDirty() {
  dirty = true;
  $('saveStatus').textContent = 'Kaydedilmedi';
}

async function save(forceStatus = true) {
  try {
    await idbSet(DB_KEY, config);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ eventTitle: config.eventTitle }));
    dirty = false;
    if (forceStatus) $('saveStatus').textContent = `Kaydedildi • ${new Date().toLocaleTimeString('tr-TR')}`;
  } catch (err) {
    $('saveStatus').textContent = 'Kaydetme hatası (tarayıcı depolama engeli?)';
    console.error(err);
  }
}

function asDataURL(file) {
  return new Promise((resolve) => {
    if (!file) return resolve('');
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

function render() {
  $('eventTitle').value = config.eventTitle || '';
  $('introPreview').src = config.introImage || '';
  renderTasks();
  renderWorkers();
  renderMachines();
  renderChanceCards();
}

function removeById(listName, id) {
  config[listName] = config[listName].filter((x) => x.id !== id);
  markDirty();
  render();
}

function bindImageInput(input, onValue) {
  input.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    const val = await asDataURL(file);
    onValue(val);
    markDirty();
    $('saveStatus').textContent = file ? `Seçildi: ${file.name} (${Math.round(file.size / 1024)} KB)` : 'Kaydedilmedi';
    render();
  });
}

function renderTasks() {
  const wrap = $('taskList');
  wrap.innerHTML = '';
  for (const item of config.tasks) {
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `<div class="row"><strong>${item.name || 'Yeni Görev'}</strong><button type="button" data-remove="${item.id}">Sil</button></div><div class="grid"><label>Görev Adı<input data-k="name" type="text" value="${item.name || ''}" /></label><label>Yük Miktarı<input data-k="load" type="number" value="${item.load ?? 0}" /></label><label>Ödül<input data-k="reward" type="number" value="${item.reward ?? 0}" /></label><label>Görsel<input data-k="imageFile" type="file" accept="image/*" /></label></div><img class="preview mini" src="${item.image || ''}" alt="" />`;
    card.querySelector('[data-remove]').addEventListener('click', () => removeById('tasks', item.id));
    card.querySelectorAll('input[data-k="name"],input[data-k="load"],input[data-k="reward"]').forEach((inp) => inp.addEventListener('input', () => {
      const key = inp.dataset.k; item[key] = key === 'name' ? inp.value : Number(inp.value || 0); markDirty();
    }));
    bindImageInput(card.querySelector('input[data-k="imageFile"]'), (v) => { item.image = v; });
    wrap.appendChild(card);
  }
}

function renderWorkers() {
  const wrap = $('workerList');
  wrap.innerHTML = '';
  for (const item of config.workers) {
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `<div class="row"><strong>${item.name || 'Yeni İşçi'}</strong><button type="button" data-remove="${item.id}">Sil</button></div><div class="grid"><label>İşçi Adı<input data-k="name" type="text" value="${item.name || ''}" /></label><label>İşçi Kuvveti<input data-k="power" type="number" value="${item.power ?? 0}" /></label><label>İşçi Maliyeti<input data-k="cost" type="number" value="${item.cost ?? 0}" /></label><label>Görsel<input data-k="imageFile" type="file" accept="image/*" /></label></div><img class="preview mini" src="${item.image || ''}" alt="" />`;
    card.querySelector('[data-remove]').addEventListener('click', () => removeById('workers', item.id));
    card.querySelectorAll('input[data-k="name"],input[data-k="power"],input[data-k="cost"]').forEach((inp) => inp.addEventListener('input', () => {
      const key = inp.dataset.k; item[key] = key === 'name' ? inp.value : Number(inp.value || 0); markDirty();
    }));
    bindImageInput(card.querySelector('input[data-k="imageFile"]'), (v) => { item.image = v; });
    wrap.appendChild(card);
  }
}

function renderMachines() {
  const wrap = $('machineList');
  wrap.innerHTML = '';
  for (const item of config.machines) {
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `<div class="row"><strong>${item.name || 'Yeni Makine'}</strong><button type="button" data-remove="${item.id}">Sil</button></div><div class="grid"><label>Makine Adı<input data-k="name" type="text" value="${item.name || ''}" /></label><label>Kuvvet Kazancı<input data-k="gain" type="number" value="${item.gain ?? 0}" /></label><label>Maliyet<input data-k="cost" type="number" value="${item.cost ?? 0}" /></label><label>Görsel<input data-k="imageFile" type="file" accept="image/*" /></label></div><img class="preview mini" src="${item.image || ''}" alt="" />`;
    card.querySelector('[data-remove]').addEventListener('click', () => removeById('machines', item.id));
    card.querySelectorAll('input[data-k="name"],input[data-k="gain"],input[data-k="cost"]').forEach((inp) => inp.addEventListener('input', () => {
      const key = inp.dataset.k; item[key] = key === 'name' ? inp.value : Number(inp.value || 0); markDirty();
    }));
    bindImageInput(card.querySelector('input[data-k="imageFile"]'), (v) => { item.image = v; });
    wrap.appendChild(card);
  }
}

function effectRowHTML(effect, idx) {
  return `<div class="effect-row" data-idx="${idx}"><select data-k="target"><option value="worker_power" ${effect.target === 'worker_power' ? 'selected' : ''}>İşçi Kuvveti</option><option value="machine_gain" ${effect.target === 'machine_gain' ? 'selected' : ''}>Kuvvet Kazancı</option><option value="worker_cost" ${effect.target === 'worker_cost' ? 'selected' : ''}>İşçi Maliyeti</option><option value="machine_cost" ${effect.target === 'machine_cost' ? 'selected' : ''}>Makine Maliyeti</option><option value="capital_reward" ${effect.target === 'capital_reward' ? 'selected' : ''}>Ödül/Sermaye</option></select><select data-k="op"><option value="+" ${effect.op === '+' ? 'selected' : ''}>+</option><option value="-" ${effect.op === '-' ? 'selected' : ''}>-</option><option value="x" ${effect.op === 'x' ? 'selected' : ''}>x</option></select><input data-k="value" type="number" step="0.1" value="${effect.value ?? 0}" /><button type="button" data-act="rm">Sil</button></div>`;
}

function renderChanceCards() {
  const wrap = $('chanceList');
  wrap.innerHTML = '';
  for (const item of config.chanceCards) {
    const card = document.createElement('article');
    card.className = 'card';
    const effects = item.effects || [];
    card.innerHTML = `<div class="row"><strong>${item.name || 'Yeni Şans Kartı'}</strong><button type="button" data-remove="${item.id}">Sil</button></div><div class="grid"><label>Şans Kartı Adı<input data-k="name" type="text" value="${item.name || ''}" /></label><label>Görsel<input data-k="imageFile" type="file" accept="image/*" /></label></div><img class="preview mini" src="${item.image || ''}" alt="" /><p class="subhead">Etkiler</p><div class="effects">${effects.map((e, idx) => effectRowHTML(e, idx)).join('')}</div><button type="button" data-act="addEffect">+ Etki Ekle</button>`;
    card.querySelector('[data-remove]').addEventListener('click', () => removeById('chanceCards', item.id));
    card.querySelector('input[data-k="name"]').addEventListener('input', (e) => { item.name = e.target.value; markDirty(); });
    bindImageInput(card.querySelector('input[data-k="imageFile"]'), (v) => { item.image = v; });
    card.querySelector('[data-act="addEffect"]').addEventListener('click', () => { item.effects = item.effects || []; item.effects.push({ target: 'worker_power', op: '+', value: 0 }); markDirty(); render(); });
    card.querySelectorAll('.effect-row').forEach((row, rowIndex) => {
      row.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('input', () => {
        const key = inp.dataset.k; item.effects[rowIndex][key] = key === 'value' ? Number(inp.value || 0) : inp.value; markDirty();
      }));
      row.querySelector('[data-act="rm"]').addEventListener('click', () => { item.effects.splice(rowIndex, 1); markDirty(); render(); });
    });
    wrap.appendChild(card);
  }
}

$('eventTitle').addEventListener('input', (e) => { config.eventTitle = e.target.value; markDirty(); });
bindImageInput($('introImage'), (v) => { config.introImage = v; $('introPreview').src = v; });
$('addTaskBtn').addEventListener('click', () => { config.tasks.push({ id: uid(), name: '', load: 0, reward: 0, image: '' }); markDirty(); render(); });
$('addWorkerBtn').addEventListener('click', () => { config.workers.push({ id: uid(), name: '', power: 0, cost: 0, image: '' }); markDirty(); render(); });
$('addMachineBtn').addEventListener('click', () => { config.machines.push({ id: uid(), name: '', gain: 0, cost: 0, image: '' }); markDirty(); render(); });
$('addChanceBtn').addEventListener('click', () => { config.chanceCards.push({ id: uid(), name: '', image: '', effects: [] }); markDirty(); render(); });
$('saveBtn').addEventListener('click', async () => { await save(); });

$('exportBtn').addEventListener('click', async () => {
  if (dirty) await save(false);
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'santiye-config.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

$('importInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const txt = await file.text();
  config = { ...defaultConfig, ...JSON.parse(txt) };
  markDirty();
  render();
});

$('resetBtn').addEventListener('click', () => {
  config = structuredClone(defaultConfig);
  markDirty();
  render();
});

window.addEventListener('beforeunload', () => {
  if (dirty) save(false);
});

(async function init() {
  config = await load();
  render();
  await save();
})();
