(() => {
  const SIM_KEY = 'plinko.simulations.v1';
  const RUN_KEY = 'plinko.runs.v1';
  const page = document.body.dataset.page;

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
      .map((sim) => `<button class="btn launch-btn" data-launch-id="${sim.id}">${escapeHtml(sim.name)}</button>`)
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

  function buildRandomObstacles(sim, width, height, leftWallX, rightWallX) {
    const obstacles = [];
    const count = sim.obstacleCount;
    const r = sim.obstacleSize;
    const margin = Math.max(r + sim.ballSize + 12, 24);
    const topBand = sim.upBallCount > 0 ? 72 : 20;
    const bottomBand = sim.downBallCount > 0 ? 72 : 20;

    for (let i = 0; i < count; i += 1) {
      let tries = 0;
      let ok = false;
      while (!ok && tries < 80) {
        tries += 1;
        const x = leftWallX + margin + Math.random() * Math.max(10, (rightWallX - leftWallX - margin * 2));
        const y = topBand + margin + Math.random() * Math.max(10, (height - topBand - bottomBand - margin * 2));

        let tooClose = false;
        for (const prev of obstacles) {
          const dx = prev.x - x;
          const dy = prev.y - y;
          if (Math.hypot(dx, dy) < r * 2 + 22) {
            tooClose = true;
            break;
          }
        }

        if (!tooClose) {
          obstacles.push({ x, y, r });
          ok = true;
        }
      }
    }

    return obstacles;
  }

  function createBalls(sim, width, height, leftWallX, rightWallX) {
    const balls = [];
    const makeBall = (dir) => {
      const yStart = dir > 0 ? sim.ballSize + 14 : height - sim.ballSize - 14;
      return {
        x: leftWallX + sim.ballSize + 14 + Math.random() * (rightWallX - leftWallX - (sim.ballSize + 14) * 2),
        y: yStart,
        vx: (Math.random() - 0.5) * 1.2,
        vy: dir * (1.2 + Math.random() * 0.3),
        done: false,
      };
    };

    for (let i = 0; i < sim.downBallCount; i += 1) balls.push(makeBall(1));
    for (let i = 0; i < sim.upBallCount; i += 1) balls.push(makeBall(-1));

    return balls;
  }

  function setupEngine(sim) {
    const canvas = el.simulationCanvas;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    const gap = Math.min(sim.wallGap, width - 80);
    const leftWallX = (width - gap) / 2;
    const rightWallX = leftWallX + gap;

    const engine = {
      sim,
      ctx,
      width,
      height,
      leftWallX,
      rightWallX,
      obstacles: buildRandomObstacles(sim, width, height, leftWallX, rightWallX),
      balls: createBalls(sim, width, height, leftWallX, rightWallX),
      running: false,
      startedAt: 0,
      rafId: 0,
      elapsed: 0,
    };

    return engine;
  }

  function draw(engine) {
    const { ctx, width, height, sim, leftWallX, rightWallX } = engine;
    ctx.fillStyle = sim.backgroundColor;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = sim.wallColor;
    const wallW = 28;
    ctx.fillRect(leftWallX - wallW, 0, wallW, height);
    ctx.fillRect(rightWallX, 0, wallW, height);

    ctx.fillStyle = sim.obstacleColor;
    for (const o of engine.obstacles) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const b of engine.balls) {
      ctx.fillStyle = sim.ballColor;
      ctx.beginPath();
      ctx.arc(b.x, b.y, sim.ballSize, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#071118';
      ctx.font = `${sim.ballSize + 4}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sim.ballSign, b.x, b.y + 1);
    }
  }

  function update(engine, dt) {
    const { sim, leftWallX, rightWallX, height } = engine;
    const radius = sim.ballSize;

    for (const b of engine.balls) {
      if (b.done) continue;

      b.vy += (b.vy > 0 ? 0.005 : -0.005) * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.x - radius < leftWallX) {
        b.x = leftWallX + radius;
        b.vx = Math.abs(b.vx) * 0.85;
      }
      if (b.x + radius > rightWallX) {
        b.x = rightWallX - radius;
        b.vx = -Math.abs(b.vx) * 0.85;
      }

      for (const o of engine.obstacles) {
        const dx = b.x - o.x;
        const dy = b.y - o.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const minDist = radius + o.r;
        if (dist >= minDist) continue;

        const nx = dx / dist;
        const ny = dy / dist;
        b.x = o.x + nx * minDist;
        b.y = o.y + ny * minDist;

        const vDot = b.vx * nx + b.vy * ny;
        b.vx = (b.vx - 2 * vDot * nx) * 0.78;
        b.vy = (b.vy - 2 * vDot * ny) * 0.78;
        b.vx += (Math.random() - 0.5) * 0.3;
      }

      const elapsedSec = engine.elapsed / 1000;
      const remain = Math.max(0.08, sim.dropDuration - elapsedSec);
      if (b.vy > 0) {
        const need = (height - radius - b.y) / remain;
        b.vy = Math.max(b.vy, need * 0.9);
      } else {
        const need = (b.y - radius) / remain;
        b.vy = Math.min(b.vy, -need * 0.9);
      }

      if (b.vy > 0 && b.y >= height - radius) b.done = true;
      if (b.vy < 0 && b.y <= radius) b.done = true;
    }
  }

  function runSimulationLoop() {
    const engine = state.engine;
    if (!engine || !engine.running) return;

    const now = performance.now();
    const dt = Math.min(24, now - engine.startedAt - engine.elapsed);
    engine.elapsed = now - engine.startedAt;

    update(engine, dt * 0.08);
    draw(engine);
    const elapsedSec = engine.elapsed / 1000;
    el.timerDisplay.textContent = `${elapsedSec.toFixed(1)}s`;

    const allDone = engine.balls.every((b) => b.done);
    if (allDone || elapsedSec >= engine.sim.dropDuration + 0.25) {
      engine.running = false;
      finishSimulation(engine);
      return;
    }

    engine.rafId = requestAnimationFrame(runSimulationLoop);
  }

  function finishSimulation(engine) {
    const total = engine.balls.length;
    const sign = engine.sim.ballSign;
    const plus = sign === '+' ? total : 0;
    const minus = sign === '-' ? total : 0;
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
    }, 700);
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
    if (!sim) return;

    el.feedButtonsView.classList.add('hidden');
    el.simulationView.classList.remove('hidden');
    el.activeSimName.textContent = sim.name;
    el.timerDisplay.style.color = sim.timerColor;
    el.timerDisplay.style.fontSize = `${sim.timerSize}px`;
    el.timerDisplay.textContent = '0.0s';

    state.engine = setupEngine(sim);
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
      if (!btn) return;
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
