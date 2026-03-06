(() => {
  const SIM_KEY = 'plinko.simulations.v3';
  const RUN_KEY = 'plinko.runs.v3';
  const page = document.body.dataset.page;

  const CANVAS_WIDTH = 1000;
  const CANVAS_HEIGHT = 620;

  const state = {
    simulations: load(SIM_KEY, []),
    runs: load(RUN_KEY, {}),
    engine: null,
  };

  const el = {
    simulationForm: document.getElementById('simulationForm'),
    simulationList: document.getElementById('simulationList'),
    feedButtonsView: document.getElementById('feedButtonsView'),
    feedButtonList: document.getElementById('feedButtonList'),
    simulationView: document.getElementById('simulationView'),
    simulationCanvas: document.getElementById('simulationCanvas'),
    activeSimName: document.getElementById('activeSimName'),
    timerDisplay: document.getElementById('timerDisplay'),
    arrivedDisplay: document.getElementById('arrivedDisplay'),
    playButton: document.getElementById('playButton'),
    countdownOverlay: document.getElementById('countdownOverlay'),
    statsButtonsView: document.getElementById('statsButtonsView'),
    statsButtonList: document.getElementById('statsButtonList'),
    statsDetailView: document.getElementById('statsDetailView'),
    statsDetail: document.getElementById('statsDetail'),
    statsBackButton: document.getElementById('statsBackButton'),
  };

  function load(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null') || fallback;
    } catch {
      return fallback;
    }
  }

  function save() {
    localStorage.setItem(SIM_KEY, JSON.stringify(state.simulations));
    localStorage.setItem(RUN_KEY, JSON.stringify(state.runs));
  }

  function uid() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function seeded(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createSimulationFromForm(form) {
    const fd = new FormData(form);
    const getNum = (id) => Number(fd.get(id));
    const sim = {
      id: uid(),
      name: String(fd.get('simName') || '').trim(),
      backgroundColor: String(fd.get('backgroundColor') || '#6c6875'),
      wallGap: getNum('wallGap'),
      wallColor: String(fd.get('wallColor') || '#c70000'),
      obstacleSize: getNum('obstacleSize'),
      obstacleCount: getNum('obstacleCount'),
      obstacleColor: String(fd.get('obstacleColor') || '#0b0b0b'),
      ballSize: getNum('ballSize'),
      ballColor: String(fd.get('ballColor') || '#21d7e6'),
      ballSign: String(fd.get('ballSign') || '+'),
      downBallCount: getNum('downBallCount'),
      upBallCount: getNum('upBallCount'),
      dropDuration: getNum('dropDuration'),
      timerColor: String(fd.get('timerColor') || '#ffffff'),
      timerSize: getNum('timerSize'),
      createdAt: Date.now(),
      compileStatus: 'Devam Ediyor',
      compileError: '',
      layout: null,
      ballPlans: [],
      precomputedRun: null,
    };

    if (!sim.name) {
      alert('Simülasyon adı zorunlu.');
      return null;
    }

    if (sim.downBallCount + sim.upBallCount < 1) {
      alert('En az 1 top olmalı.');
      return null;
    }

    return sim;
  }

  function buildLayoutAndPlans(sim) {
    const seedNumber = Number(String(sim.createdAt).slice(-9)) ^ sim.name.length;
    const rand = seeded(seedNumber);

    const width = CANVAS_WIDTH;
    const height = CANVAS_HEIGHT;
    const gap = Math.min(sim.wallGap, width - 80);
    const leftWallX = (width - gap) / 2;
    const rightWallX = leftWallX + gap;

    const obstacles = [];
    const margin = Math.max(sim.obstacleSize + sim.ballSize + 12, 26);
    const topBand = sim.upBallCount > 0 ? 78 : 20;
    const bottomBand = sim.downBallCount > 0 ? 78 : 20;

    for (let i = 0; i < sim.obstacleCount; i += 1) {
      let ok = false;
      let tries = 0;
      while (!ok && tries < 120) {
        tries += 1;
        const x = leftWallX + margin + rand() * Math.max(10, rightWallX - leftWallX - margin * 2);
        const y = topBand + margin + rand() * Math.max(10, height - topBand - bottomBand - margin * 2);

        let tooClose = false;
        for (const prev of obstacles) {
          if (Math.hypot(prev.x - x, prev.y - y) < sim.obstacleSize * 2 + 18) {
            tooClose = true;
            break;
          }
        }

        if (!tooClose) {
          obstacles.push({ x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), r: sim.obstacleSize });
          ok = true;
        }
      }
    }

    const total = sim.downBallCount + sim.upBallCount;
    const allDirs = [
      ...Array.from({ length: sim.downBallCount }, () => 1),
      ...Array.from({ length: sim.upBallCount }, () => -1),
    ];

    const totalMs = sim.dropDuration * 1000;
    const earliestArrival = Math.max(700, totalMs * 0.22);
    const latestArrival = Math.max(earliestArrival + 120, totalMs * 0.96);
    const nominalStep = total <= 1 ? 0 : (latestArrival - earliestArrival) / (total - 1);

    const ballPlans = [];
    let prevArrival = 0;

    for (let i = 0; i < allDirs.length; i += 1) {
      const remaining = allDirs.length - i - 1;
      const minArrival = i === 0 ? earliestArrival : prevArrival + 70;
      const maxArrival = latestArrival - remaining * 70;
      const baseArrival = earliestArrival + nominalStep * i;
      const jitter = nominalStep > 0 ? (rand() - 0.5) * nominalStep * 0.55 : 0;
      const arrivalMs = Math.max(minArrival, Math.min(maxArrival, baseArrival + jitter));
      prevArrival = arrivalMs;

      const maxTravel = Math.max(420, Math.min(arrivalMs - 100, totalMs * 0.75));
      const minTravel = Math.min(maxTravel, Math.max(320, totalMs * 0.2));
      const travelMs = minTravel + (maxTravel - minTravel) * rand();
      const spawnMs = Math.max(0, arrivalMs - travelMs);

      const pad = sim.ballSize + 18;
      const startX = leftWallX + pad + rand() * (rightWallX - leftWallX - pad * 2);

      ballPlans.push({
        id: uid(),
        dir: allDirs[i],
        spawnMs: Number(spawnMs.toFixed(2)),
        arrivalMs: Number(arrivalMs.toFixed(2)),
        travelMs: Number(travelMs.toFixed(2)),
        startX: Number(startX.toFixed(2)),
        endOffset: Number(((rand() - 0.5) * 34).toFixed(2)),
        amp1: Number((16 + rand() * 40).toFixed(2)),
        amp2: Number((6 + rand() * 22).toFixed(2)),
        phase1: Number((rand() * Math.PI * 2).toFixed(4)),
        phase2: Number((rand() * Math.PI * 2).toFixed(4)),
      });
    }

    return {
      layout: { width, height, leftWallX, rightWallX, obstacles },
      ballPlans,
    };
  }

  function computeBallState(sim, layout, plan, elapsedMs) {
    if (elapsedMs < plan.spawnMs) {
      return { active: false, done: false, x: 0, y: 0 };
    }

    const radius = sim.ballSize;
    const localT = Math.min(1, (elapsedMs - plan.spawnMs) / Math.max(plan.travelMs, 120));

    const startY = plan.dir > 0 ? radius + 14 : layout.height - radius - 14;
    const endY = plan.dir > 0 ? layout.height - radius : radius;
    const y = startY + (endY - startY) * localT;

    let x = plan.startX + plan.endOffset * localT;
    x += Math.sin(localT * Math.PI * 2.8 + plan.phase1) * plan.amp1;
    x += Math.sin(localT * Math.PI * 7.4 + plan.phase2) * plan.amp2;

    for (const o of layout.obstacles) {
      const dx = x - o.x;
      const dy = y - o.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const influence = sim.ballSize + o.r + 22;
      if (dist < influence) {
        const push = (influence - dist) * 0.9;
        x += (dx / dist) * push;
      }
    }

    const minX = layout.leftWallX + radius;
    const maxX = layout.rightWallX - radius;
    x = Math.max(minX, Math.min(maxX, x));

    return {
      active: localT < 1,
      done: localT >= 1,
      x,
      y,
    };
  }

  function runPrecompute(sim) {
    const built = buildLayoutAndPlans(sim);
    sim.layout = built.layout;
    sim.ballPlans = built.ballPlans;

    const finalElapsed = sim.dropDuration * 1000;
    const doneCount = sim.ballPlans.reduce((acc, plan) => {
      const info = computeBallState(sim, sim.layout, plan, finalElapsed);
      return acc + (info.done ? 1 : 0);
    }, 0);

    const totalCount = sim.ballPlans.length;
    if (doneCount !== totalCount) {
      sim.compileStatus = 'Hata';
      sim.compileError = 'Ön hesaplama tamamlanamadı.';
      return;
    }

    const plusCount = sim.ballSign === '+' ? totalCount : 0;
    const minusCount = sim.ballSign === '-' ? totalCount : 0;
    const elapsedSec = Number(sim.dropDuration.toFixed(3));

    sim.precomputedRun = {
      plusCount,
      minusCount,
      totalCount,
      elapsedSec,
      current: Number((totalCount / Math.max(elapsedSec, 0.001)).toFixed(3)),
    };
    sim.compileStatus = 'Tamamlandı';
    sim.compileError = '';
  }

  function renderAdminList() {
    if (!el.simulationList) return;
    if (!state.simulations.length) {
      el.simulationList.innerHTML = '<p>Henüz simülasyon yok.</p>';
      return;
    }

    el.simulationList.innerHTML = state.simulations
      .map((sim) => `
        <article class="item-row">
          <div>
            <p><strong>${escapeHtml(sim.name)}</strong></p>
            <small>Toplam top: ${sim.downBallCount + sim.upBallCount} • Engel: ${sim.obstacleCount} • Süre: ${sim.dropDuration}s</small>
            <small>Durum: <span class="status ${sim.compileStatus === 'Tamamlandı' ? 'ok' : ''}">${sim.compileStatus}</span>${sim.compileError ? ` (${escapeHtml(sim.compileError)})` : ''}</small>
          </div>
          <button class="btn" data-delete-id="${sim.id}">Sil</button>
        </article>
      `)
      .join('');
  }

  function renderFeedButtons() {
    if (!el.feedButtonList) return;
    if (!state.simulations.length) {
      el.feedButtonList.innerHTML = '<p>Kayıtlı simülasyon yok. Önce Admin sayfasından oluşturun.</p>';
      return;
    }

    el.feedButtonList.innerHTML = state.simulations
      .map((sim) => `<button class="btn launch-btn" data-launch-id="${sim.id}" ${sim.compileStatus !== 'Tamamlandı' ? 'disabled' : ''}>${escapeHtml(sim.name)} ${sim.compileStatus !== 'Tamamlandı' ? '• Devam Ediyor' : ''}</button>`)
      .join('');
  }

  function renderStatsButtons() {
    if (!el.statsButtonList) return;
    if (!state.simulations.length) {
      el.statsButtonList.innerHTML = '<p>Kayıtlı simülasyon yok.</p>';
      return;
    }

    el.statsButtonList.innerHTML = state.simulations
      .map((sim) => `<button class="btn launch-btn" data-stats-id="${sim.id}">${escapeHtml(sim.name)}</button>`)
      .join('');
  }

  function setupEngine(sim) {
    const canvas = el.simulationCanvas;
    const ctx = canvas.getContext('2d');
    return {
      sim,
      layout: sim.layout,
      ctx,
      running: false,
      startedAt: 0,
      elapsed: 0,
      runtimeBalls: [],
      doneCount: 0,
    };
  }

  function draw(engine) {
    const { ctx, sim, layout } = engine;
    ctx.fillStyle = sim.backgroundColor;
    ctx.fillRect(0, 0, layout.width, layout.height);

    ctx.fillStyle = sim.wallColor;
    const wallW = 28;
    ctx.fillRect(layout.leftWallX - wallW, 0, wallW, layout.height);
    ctx.fillRect(layout.rightWallX, 0, wallW, layout.height);

    ctx.fillStyle = sim.obstacleColor;
    for (const o of layout.obstacles) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const b of engine.runtimeBalls) {
      if (!b.active) continue;
      ctx.fillStyle = sim.ballColor;
      ctx.beginPath();
      ctx.arc(b.x, b.y, sim.ballSize, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#08111b';
      ctx.font = `${sim.ballSize + 4}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sim.ballSign, b.x, b.y + 1);
    }
  }

  function updateRuntimeBalls(engine) {
    engine.runtimeBalls = engine.sim.ballPlans.map((plan) => computeBallState(engine.sim, engine.layout, plan, engine.elapsed));
    engine.doneCount = engine.runtimeBalls.reduce((acc, b) => acc + (b.done ? 1 : 0), 0);
  }

  function runSimulationLoop() {
    const engine = state.engine;
    if (!engine || !engine.running) return;

    const now = performance.now();
    engine.elapsed = now - engine.startedAt;

    updateRuntimeBalls(engine);
    draw(engine);

    const elapsedSec = engine.elapsed / 1000;
    el.timerDisplay.textContent = `${elapsedSec.toFixed(1)}s`;
    if (el.arrivedDisplay) {
      el.arrivedDisplay.textContent = `Geçen top: ${engine.doneCount}/${engine.sim.ballPlans.length}`;
    }

    const reachedDuration = elapsedSec >= engine.sim.dropDuration;
    const allDone = engine.doneCount === engine.sim.ballPlans.length;
    if (reachedDuration && allDone) {
      engine.running = false;
      finishSimulation(engine);
      return;
    }

    requestAnimationFrame(runSimulationLoop);
  }

  function finishSimulation(engine) {
    const total = engine.sim.ballPlans.length;
    const plus = engine.sim.ballSign === '+' ? total : 0;
    const minus = engine.sim.ballSign === '-' ? total : 0;
    const elapsed = Number((engine.elapsed / 1000).toFixed(3));

    state.runs[engine.sim.id] = {
      simulationId: engine.sim.id,
      simulationName: engine.sim.name,
      plusCount: plus,
      minusCount: minus,
      totalCount: total,
      elapsedSec: elapsed,
      current: Number(((plus + minus) / Math.max(elapsed, 0.001)).toFixed(3)),
      finishedAt: Date.now(),
    };
    save();

    setTimeout(() => {
      el.simulationView.classList.add('hidden');
      el.feedButtonsView.classList.remove('hidden');
      state.engine = null;
      renderFeedButtons();
    }, 600);
  }

  function showCountdown(startFn) {
    let n = 3;
    el.countdownOverlay.classList.remove('hidden');
    el.countdownOverlay.textContent = String(n);
    const iv = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(iv);
        el.countdownOverlay.classList.add('hidden');
        startFn();
      } else {
        el.countdownOverlay.textContent = String(n);
      }
    }, 1000);
  }

  function openSimulation(simId) {
    const sim = state.simulations.find((x) => x.id === simId);
    if (!sim || sim.compileStatus !== 'Tamamlandı' || !sim.layout || !sim.ballPlans?.length) return;

    el.feedButtonsView.classList.add('hidden');
    el.simulationView.classList.remove('hidden');
    el.activeSimName.textContent = sim.name;
    el.timerDisplay.style.color = sim.timerColor;
    el.timerDisplay.style.fontSize = `${sim.timerSize}px`;
    el.timerDisplay.textContent = '0.0s';
    if (el.arrivedDisplay) el.arrivedDisplay.textContent = `Geçen top: 0/${sim.ballPlans.length}`;

    state.engine = setupEngine(sim);
    state.engine.runtimeBalls = sim.ballPlans.map(() => ({ active: false, done: false, x: 0, y: 0 }));
    draw(state.engine);

    el.playButton.disabled = false;
    el.playButton.onclick = () => {
      el.playButton.disabled = true;
      showCountdown(() => {
        if (!state.engine) return;
        state.engine.running = true;
        state.engine.startedAt = performance.now();
        state.engine.elapsed = 0;
        runSimulationLoop();
      });
    };
  }

  function showStats(simId) {
    const sim = state.simulations.find((x) => x.id === simId);
    if (!sim) return;

    const run = state.runs[sim.id];
    el.statsButtonsView.classList.add('hidden');
    el.statsDetailView.classList.remove('hidden');

    if (!run) {
      el.statsDetail.innerHTML = `<h3>${escapeHtml(sim.name)}</h3><p>Henüz bu simülasyon oynatılmadı.</p>`;
      return;
    }

    el.statsDetail.innerHTML = `
      <h3>${escapeHtml(run.simulationName)}</h3>
      <p>Geçen + yük sayısı : ${run.plusCount}</p>
      <p>Geçen - yük sayısı : ${run.minusCount}</p>
      <p>Toplam yük sayısı : ${run.totalCount}</p>
      <p>Geçen süre : ${run.elapsedSec} sn</p>
      <p><strong>SONUÇ</strong></p>
      <p>Akım Büyüklüğü : ${run.totalCount} / ${run.elapsedSec} = ${run.current}</p>
    `;
  }

  function wireAdmin() {
    renderAdminList();

    el.simulationForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const sim = createSimulationFromForm(el.simulationForm);
      if (!sim) return;

      state.simulations.unshift(sim);
      save();
      renderAdminList();

      setTimeout(() => {
        runPrecompute(sim);
        save();
        renderAdminList();
      }, 40);

      el.simulationForm.reset();
      document.getElementById('wallGap').value = '760';
      document.getElementById('obstacleCount').value = '18';
      document.getElementById('downBallCount').value = '8';
      document.getElementById('dropDuration').value = '14';
    });

    el.simulationList.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-delete-id]');
      if (!btn) return;
      const id = btn.getAttribute('data-delete-id');
      state.simulations = state.simulations.filter((x) => x.id !== id);
      delete state.runs[id];
      save();
      renderAdminList();
    });
  }

  function wireFeed() {
    renderFeedButtons();
    el.feedButtonList.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-launch-id]');
      if (!btn || btn.hasAttribute('disabled')) return;
      openSimulation(btn.getAttribute('data-launch-id'));
    });
  }

  function wireStats() {
    renderStatsButtons();
    el.statsButtonList.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-stats-id]');
      if (!btn) return;
      showStats(btn.getAttribute('data-stats-id'));
    });

    el.statsBackButton.addEventListener('click', () => {
      el.statsDetailView.classList.add('hidden');
      el.statsButtonsView.classList.remove('hidden');
    });
  }

  function assignFormNames() {
    const ids = [
      'simName', 'backgroundColor', 'wallGap', 'wallColor', 'obstacleSize', 'obstacleCount',
      'obstacleColor', 'ballSize', 'ballColor', 'ballSign', 'downBallCount', 'upBallCount',
      'dropDuration', 'timerColor', 'timerSize',
    ];
    for (const id of ids) {
      const input = document.getElementById(id);
      if (input) input.name = id;
    }
  }

  function init() {
    assignFormNames();
    if (page === 'admin') wireAdmin();
    if (page === 'feed') wireFeed();
    if (page === 'stats') wireStats();
  }

  init();
})();
