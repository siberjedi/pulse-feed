const STORAGE_KEY = 'santiyeConfig.v1';
const DB_NAME = 'santiye_game_db';
const STORE_NAME = 'kv';
const DB_KEY = 'config';

const DEFAULT_GAME_DATA = {
  eventTitle: 'Şantiye Patronu',
  introImage: 'assets/Giriş.JPG',
  tasks: [
    { id: 1, name: 'Çimento Krizi', load: 150, reward: 80, image: 'assets/Görev1.JPG' },
    { id: 2, name: 'Patronun Kasası', load: 200, reward: 90, image: 'assets/Görev2.JPG' },
    { id: 3, name: 'Trafo Kablosu', load: 300, reward: 120, image: 'assets/Görev3.JPG' },
    { id: 4, name: 'Tarihi Sütun', load: 400, reward: 160, image: 'assets/Görev4.JPG' },
    { id: 5, name: 'Su Deposu', load: 500, reward: 200, image: 'assets/Görev5.JPG' },
    { id: 6, name: 'Asansör Motoru', load: 600, reward: 250, image: 'assets/Görev6.JPG' },
    { id: 7, name: 'Asırlık Zeytin', load: 800, reward: 300, image: 'assets/Görev7.JPG' },
    { id: 8, name: 'Tahliye Pompası', load: 1000, reward: 380, image: 'assets/Görev8.JPG' },
    { id: 9, name: 'Çelik İskelet', load: 1200, reward: 450, image: 'assets/Görev9.JPG' },
    { id: 10, name: 'Deprem İzolatörü', load: 1500, reward: 550, image: 'assets/Görev10.JPG' },
    { id: 11, name: 'Patronun Jipi (Final)', load: 2000, reward: 700, image: 'assets/Görev11.JPG' },
  ],
  workers: [{ id: 'w1', name: 'Örnek İşçi', power: 25, cost: 0, image: '' }],
  machines: [{ id: 'm1', name: 'Örnek Makine', gain: 4, cost: 100, image: '' }],
  chanceCards: [{ id: 'c1', name: 'Örnek Şans', image: '', effects: [] }],
  roundPairs: [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11]],
};

let GAME_DATA = structuredClone(DEFAULT_GAME_DATA);
const state = { groupCount: 4, startingCapital: 5000, groups: [], round: 1, infoIndex: 0, selectedChanceCard: null, timerId: null, secondsLeft: 180 };
const $ = (id) => document.getElementById(id);
const ROUND_TASK_INDEXES = [[0,1],[2,3],[4,5],[6,7],[8,9],[10]];

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

async function loadConfig() {
  try {
    const fromDb = await idbGet(DB_KEY);
    if (fromDb) return { ...DEFAULT_GAME_DATA, ...fromDb, roundPairs: DEFAULT_GAME_DATA.roundPairs };
  } catch {}
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULT_GAME_DATA, ...stored, roundPairs: DEFAULT_GAME_DATA.roundPairs };
  } catch {
    return structuredClone(DEFAULT_GAME_DATA);
  }
}

function applyEffects(base, chance, target) {
  if (!chance?.effects?.length) return base;
  return chance.effects
    .filter((e) => e.target === target)
    .reduce((val, effect) => {
      const n = Number(effect.value || 0);
      if (effect.op === '+') return val + n;
      if (effect.op === '-') return val - n;
      if (effect.op === 'x') return val * n;
      return val;
    }, base);
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
}

document.querySelector('[data-next="setup"]').addEventListener('click', () => showScreen('setup'));


$('toNamesBtn').addEventListener('click', () => {
  state.groupCount = Number($('groupCountSelect').value);
  state.startingCapital = Number($('startingCapitalInput').value) || 0;
  const wrap = $('groupNameInputs');
  wrap.innerHTML = '';
  for (let i = 1; i <= state.groupCount; i += 1) {
    const label = document.createElement('label');
    label.innerHTML = `Grup ${i} Adı <input type="text" required placeholder="Grup ${i}" />`;
    wrap.appendChild(label);
  }
  showScreen('names');
});

$('toInfoBtn').addEventListener('click', () => {
  const inputs = [...document.querySelectorAll('#groupNameInputs input')];
  state.groups = inputs.map((input, idx) => ({ name: input.value.trim() || `Grup ${idx + 1}`, capital: state.startingCapital, completed: 0, logs: [] }));
  showScreen('info');
  renderInfoSlide();
});

function renderInfoSlide() {
  document.querySelectorAll('.info-slide').forEach((slide, idx) => slide.classList.toggle('active', idx === state.infoIndex));
  $('infoPrevBtn').disabled = state.infoIndex === 0;
  $('infoNextBtn').textContent = state.infoIndex === 3 ? 'Oyuna Başla' : 'Sonraki';
}
$('infoPrevBtn').addEventListener('click', () => { state.infoIndex = Math.max(0, state.infoIndex - 1); renderInfoSlide(); });
$('infoNextBtn').addEventListener('click', () => {
  if (state.infoIndex < 3) return state.infoIndex += 1, renderInfoSlide();
  state.round = 1; prepareRound(); showScreen('round-flow');
});

function prepareRound() {
  $('roundTitle').textContent = state.round === 6 ? 'Final Görevi' : `${state.round}. Görev`;
  const hasChance = state.round > 1;
  $('chanceAnimation').classList.toggle('hidden', !hasChance);
  $('selectedChanceCard').classList.toggle('hidden', !hasChance);
  if (hasChance) runChanceAnimation(); else state.selectedChanceCard = null;
}

function runChanceAnimation() {
  const anim = $('chanceAnimation');
  const selected = $('selectedChanceCard');
  const cards = GAME_DATA.chanceCards || [];
  if (!cards.length) {
    state.selectedChanceCard = null;
    anim.textContent = 'Şans kartı bulunamadı.';
    selected.textContent = '';
    return;
  }
  let i = 0;
  const interval = setInterval(() => {
    anim.textContent = `Şans Kartı: ${cards[i % cards.length].name}`;
    i += 1;
  }, 320);
  setTimeout(() => {
    clearInterval(interval);
    state.selectedChanceCard = cards[Math.floor(Math.random() * cards.length)];
    selected.innerHTML = `<strong>Seçilen Şans Kartı:</strong> ${state.selectedChanceCard.name}${state.selectedChanceCard.image ? `<br><img class="chance-card-img" src="${state.selectedChanceCard.image}" alt="${state.selectedChanceCard.name}" />` : ''}`;
  }, 3000);
}

$('toTaskBtn').addEventListener('click', async () => { showScreen('task'); await showOverlayCountdown(3); renderTaskCards(); startTaskTimer(); });

function currentRoundTasks() {
  const idxs = ROUND_TASK_INDEXES[state.round - 1] || [];
  return idxs.map((i) => GAME_DATA.tasks[i]).filter(Boolean);
}

function renderCapitalsBoard() {
  const html = state.groups.map((g) => `<div><strong>${g.name}</strong>: ${g.capital} TL</div>`).join('');
  $('capitalsBoard').innerHTML = `<strong>Güncel Sermayeler</strong><div class="capital-list">${html}</div>`;
}

function renderTaskCards() {
  const tasks = currentRoundTasks();
  $('taskCards').innerHTML = tasks.map((t) => `<article class="card"><img src="${t.image || ''}" alt="${t.name}" /><h3>${t.name}</h3><p>Yük: ${t.load}</p><p>Ödül: ${t.reward}</p></article>`).join('');
  $('chancePinned').innerHTML = state.selectedChanceCard ? `<strong>Aktif Şans Kartı:</strong> ${state.selectedChanceCard.name}${state.selectedChanceCard.image ? `<br><img class="chance-card-img" src="${state.selectedChanceCard.image}" alt="${state.selectedChanceCard.name}" />` : ''}` : '<strong>Bu tur şans kartı yok.</strong>';
  renderCapitalsBoard();
}

async function showOverlayCountdown(from) {
  const overlay = $('overlayCountdown');
  overlay.classList.remove('hidden');
  for (let i = from; i >= 1; i -= 1) { overlay.textContent = i; beep(700, 0.18); await wait(1000); }
  overlay.classList.add('hidden');
}

function startTaskTimer() {
  clearInterval(state.timerId);
  state.secondsLeft = 180;
  renderTimer();
  state.timerId = setInterval(async () => {
    state.secondsLeft -= 1;
    if (state.secondsLeft <= 3 && state.secondsLeft > 0) beep(900, 0.1);
    if (state.secondsLeft === 3) await showOverlayCountdown(3);
    if (state.secondsLeft <= 0) { clearInterval(state.timerId); $('taskTimer').textContent = '00:00'; beep(220, 0.45); return; }
    renderTimer();
  }, 1000);
}
function renderTimer() { const m = String(Math.floor(state.secondsLeft / 60)).padStart(2, '0'); const s = String(state.secondsLeft % 60).padStart(2, '0'); $('taskTimer').textContent = `${m}:${s}`; }

$('toScoreBtn').addEventListener('click', () => { clearInterval(state.timerId); renderScoreForm(); showScreen('score'); });

function renderScoreForm() {
  $('scoreTitle').textContent = `${state.round}. Görev - Puan Hesaplama`;
  const taskOptions = currentRoundTasks().map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
  const workerOptions = (GAME_DATA.workers || []).map((w) => `<option value="${w.id}">${w.name}</option>`).join('');
  const machineOptions = (GAME_DATA.machines || []).map((m) => `<option value="${m.id}">${m.name}</option>`).join('');
  $('groupScoreForms').innerHTML = state.groups.map((group, idx) => `<article class="card"><h3>${group.name} (Sermaye: ${group.capital})</h3><label>Seçilen İhale<select data-kind="task" data-group="${idx}">${taskOptions}</select></label><label>Seçilen İşçi<select data-kind="worker" data-group="${idx}">${workerOptions}</select></label><label>Seçilen Makine<select data-kind="machine" data-group="${idx}">${machineOptions}</select></label></article>`).join('');
  $('scoreResults').innerHTML = '';
  $('nextRoundBtn').classList.add('hidden');
}

$('calculateBtn').addEventListener('click', () => {
  const results = state.groups.map((group, idx) => {
    const task = GAME_DATA.tasks.find((t) => String(t.id) === document.querySelector(`select[data-kind="task"][data-group="${idx}"]`).value);
    const worker = GAME_DATA.workers.find((w) => String(w.id) === document.querySelector(`select[data-kind="worker"][data-group="${idx}"]`).value);
    const machine = GAME_DATA.machines.find((m) => String(m.id) === document.querySelector(`select[data-kind="machine"][data-group="${idx}"]`).value);
    const chance = state.selectedChanceCard;

    const budgetWithChance = applyEffects(group.capital, chance, 'capital_reward');
    const workerCost = applyEffects(Number(worker?.cost || 0), chance, 'worker_cost');
    const machineCost = applyEffects(Number(machine?.cost || 0), chance, 'machine_cost');
    const totalCost = workerCost + machineCost;
    const costCondition = totalCost <= budgetWithChance;

    const workerPower = applyEffects(Number(worker?.power || 0), chance, 'worker_power');
    const machineGain = applyEffects(Number(machine?.gain || 0), chance, 'machine_gain');
    const effort = workerPower * machineGain;
    const taskCondition = effort >= Number(task?.load || 0);

    const completed = costCondition && taskCondition;
    if (completed) group.completed += 1;

    const newCapital = budgetWithChance - totalCost + (completed ? Number(task?.reward || 0) : 0);
    group.capital = Math.max(0, Math.round(newCapital));

    return { name: group.name, completed, taskName: task?.name, workerName: worker?.name, machineName: machine?.name, workerCost, machineCost, totalCost, budgetWithChance, workerPower, machineGain, effort, load: task?.load || 0, newCapital: group.capital, chanceName: chance?.name || 'Yok' };
  });

  $('scoreResults').innerHTML = results.map((r) => `<article class="result-card"><h3>${r.name}</h3><p>Durum: <strong>${r.completed ? 'Görev Tamamlandı' : 'Görev Tamamlanamadı'}</strong></p><p>İhale: ${r.taskName} | İşçi: ${r.workerName} | Makine: ${r.machineName}</p><p>Şans Kartı: ${r.chanceName}</p><p>Maliyet: İşçi ${r.workerCost} + Makine ${r.machineCost} = ${r.totalCost} (Bütçe ${r.budgetWithChance})</p><p>Kuvvet: ${r.workerPower} x ${r.machineGain} = ${r.effort} (Yük ${r.load})</p><p><strong>Yeni Sermaye: ${r.newCapital}</strong></p></article>`).join('');
  const winner = [...state.groups].sort((a, b) => b.capital - a.capital)[0];
  $('scoreResults').insertAdjacentHTML('beforeend', `<p><strong>Bu tur lider:</strong> ${winner.name}</p>`);
  $('nextRoundBtn').classList.remove('hidden');
  renderCapitalsBoard();
});

$('nextRoundBtn').addEventListener('click', () => {
  if (state.round === 6) { renderFinal(); showScreen('final'); return; }
  state.round += 1; prepareRound(); showScreen('round-flow');
});

function renderFinal() {
  const ranked = [...state.groups].map((g) => ({ ...g, finalPoint: g.completed * 100 + g.capital })).sort((a, b) => b.finalPoint - a.finalPoint);
  $('finalResults').innerHTML = `<h2>Kazanan Grup: ${ranked[0]?.name || '-'}</h2>` + ranked.map((g, i) => `<article class="result-card"><h3>${i + 1}. ${g.name}</h3><p>Tamamlanan Görev: ${g.completed}</p><p>Kalan Sermaye: ${g.capital}</p><p><strong>Final Puanı: ${g.finalPoint}</strong></p></article>`).join('');
}

$('restartBtn').addEventListener('click', () => window.location.reload());
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function beep(freq, durationSec) { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value = freq; gain.gain.value = 0.05; osc.start(); osc.stop(ctx.currentTime + durationSec); }



function renderInfoExamples() {
  if ($('infoTaskExample')) $('infoTaskExample').src = GAME_DATA.tasks?.[0]?.image || '';
  if ($('infoWorkerExample')) $('infoWorkerExample').src = GAME_DATA.workers?.[0]?.image || '';
  if ($('infoMachineExample')) $('infoMachineExample').src = GAME_DATA.machines?.[0]?.image || '';
  if ($('infoChanceExample')) $('infoChanceExample').src = GAME_DATA.chanceCards?.[0]?.image || '';
}

(async function initConfig(){
  GAME_DATA = await loadConfig();
  $('introImage').src = GAME_DATA.introImage || DEFAULT_GAME_DATA.introImage;
  document.title = `${GAME_DATA.eventTitle || 'Şantiye Patronu'} - Etkinlik Akışı`;
  renderInfoExamples();
})();
