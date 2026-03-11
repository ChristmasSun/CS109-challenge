/* ============================================================
   SUMMARY — Level completion screen + replay system
   ============================================================

   Shows detailed post-level analysis:
   - Score + grade
   - MLE vs Bayes error comparison
   - Entropy progression
   - Turn-by-turn replay with Prior → Likelihood → Posterior
   ============================================================ */

import { GRID, CELLS, gaussianPDF, bootstrapCI } from './math.js';
import { LEVELS } from './gamestate.js';

// ── Replay state ───────────────────────────────────────────────
let replayIdx = 0;
let replayStage = 0;  // 0=prior, 1=likelihood, 2=posterior
let replayAutoPlay = false;
let replayInterval = null;

export function showSummary(game) {
  const overlay = document.getElementById('overlay');
  const isWin = game.phase === 'WON';
  const score = isWin ? game.computeScore() : Math.round(game.computeScore() * 0.4);
  const grade = game.getGrade(score);
  const lvl = game.levelConfig;
  const hasNext = isWin && game.currentLevel < LEVELS.length - 1;

  // Compute MLE vs Bayes advantage
  const avgBayes = game.bayesErrors.length > 0
    ? game.bayesErrors.reduce((a, b) => a + b) / game.bayesErrors.length : 0;
  const avgMLE = game.mleErrors.length > 0
    ? game.mleErrors.reduce((a, b) => a + b) / game.mleErrors.length : 0;
  const bayesAdvantage = avgMLE > 0 ? ((avgMLE - avgBayes) / avgMLE * 100).toFixed(0) : 0;

  const evRatio = game.moveCount > 0
    ? Math.round(game.evFollowCount / game.moveCount * 100) : 0;

  // Bootstrap CI on Bayes errors
  const boot = bootstrapCI(game.bayesErrors);
  const bootHTML = boot
    ? `95% CI: [${boot.lo.toFixed(2)}, ${boot.hi.toFixed(2)}]`
    : 'Not enough data';

  overlay.innerHTML = `
    <h2 style="color:${isWin ? '#66ddff' : '#ff4466'}">
      ${isWin ? `Level ${game.currentLevel + 1} Complete!` : 'Defeated...'}
    </h2>
    <h1 style="font-size:48px; color:${gradeColor(grade)}; margin:4px 0">${grade}</h1>
    <p style="color:#aabbcc; font-size:16px; margin-bottom:12px">Score: ${score}</p>

    <div style="display:flex; gap:20px; margin-bottom:16px; flex-wrap:wrap; justify-content:center">
      <div class="summary-stat">
        <span class="summary-label">Level</span>
        <span class="summary-val">${lvl.name}</span>
      </div>
      <div class="summary-stat">
        <span class="summary-label">Turns</span>
        <span class="summary-val">${game.turn}</span>
      </div>
      <div class="summary-stat">
        <span class="summary-label">Lives Left</span>
        <span class="summary-val">${'\u2665'.repeat(game.lives)}</span>
      </div>
      <div class="summary-stat">
        <span class="summary-label">Monsters Hit</span>
        <span class="summary-val">${game.monstersDefeated}</span>
      </div>
      <div class="summary-stat">
        <span class="summary-label">Scans Used</span>
        <span class="summary-val">${game.scanCount}</span>
      </div>
      <div class="summary-stat">
        <span class="summary-label">Followed EV</span>
        <span class="summary-val">${evRatio}%</span>
      </div>
    </div>

    <details class="summary-details" open>
      <summary>Analysis: MLE vs Bayes</summary>
      <div class="summary-charts">
        <canvas id="summary-error-chart" width="500" height="180"></canvas>
        <p style="font-size:11px; color:#8899bb; margin-top:4px">
          Bayes was <strong style="color:#44aaff">${bayesAdvantage}% more accurate</strong> than MLE.
          Mean error — Bayes: ${avgBayes.toFixed(2)}, MLE: ${avgMLE.toFixed(2)}<br>
          Bootstrap ${bootHTML}
        </p>
      </div>
    </details>

    <details class="summary-details">
      <summary>Entropy Over Time</summary>
      <canvas id="summary-entropy-chart" width="500" height="160"></canvas>
    </details>

    <details class="summary-details">
      <summary>Turn-by-Turn Replay (Slow Motion)</summary>
      <div style="display:flex; align-items:center; gap:12px; justify-content:center; margin:8px 0">
        <button class="tut-next" id="replay-prev">\u25C0 Prev</button>
        <button class="tut-next" id="replay-play">\u25B6 Auto</button>
        <button class="tut-next" id="replay-next">Next \u25B6</button>
        <span id="replay-label" style="color:#8899bb; font-size:11px">Turn 1 / ${game.history.length}</span>
      </div>
      <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap">
        <div style="text-align:center">
          <div style="color:#667788; font-size:10px; margin-bottom:2px" id="stage-label">Prior (after prediction)</div>
          <canvas id="replay-canvas" width="256" height="256" style="border-radius:4px"></canvas>
        </div>
      </div>
      <div style="display:flex; justify-content:center; gap:6px; margin-top:6px">
        <button class="tut-next replay-stage-btn" data-stage="0">Prior</button>
        <button class="tut-next replay-stage-btn" data-stage="1">Likelihood</button>
        <button class="tut-next replay-stage-btn" data-stage="2">Posterior</button>
      </div>
    </details>

    <details class="summary-details">
      <summary>Bootstrap Analysis (CLT)</summary>
      <canvas id="summary-bootstrap-chart" width="500" height="180"></canvas>
    </details>

    <div style="margin-top:16px; display:flex; gap:10px; justify-content:center">
      ${hasNext ? '<button class="start-btn" id="next-level-btn">Next Level \u2192</button>' : ''}
      <button class="start-btn" id="retry-btn">${isWin ? 'Replay Level' : 'Try Again'}</button>
    </div>
  `;

  overlay.classList.remove('hidden');

  // Draw charts after DOM update
  requestAnimationFrame(() => {
    drawErrorChart(game);
    drawEntropyChart(game);
    drawBootstrapChart(game);
    initReplay(game);
  });
}

function gradeColor(grade) {
  const colors = { 'S': '#ffdd00', 'A+': '#66ffaa', 'A': '#44dd88', 'B+': '#44aaff',
    'B': '#4488dd', 'C+': '#aa88ff', 'C': '#8866cc', 'D': '#ff8844', 'F': '#ff4444' };
  return colors[grade] || '#ffffff';
}

// ── MLE vs Bayes error chart ───────────────────────────────────
function drawErrorChart(game) {
  const canvas = document.getElementById('summary-error-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const be = game.bayesErrors, me = game.mleErrors;
  if (be.length < 2) return;
  const n = be.length;
  const maxE = Math.max(...be, ...me) * 1.1 + 0.1;

  // MLE line (behind)
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * W, y = H - 20 - (me[i] / maxE) * (H - 30);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#ff884488';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Bayes line (front)
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * W, y = H - 20 - (be[i] / maxE) * (H - 30);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#44aaff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Legend
  ctx.fillStyle = '#44aaff';
  ctx.font = '10px monospace';
  ctx.fillText('\u25CF Bayes MAP', 10, 12);
  ctx.fillStyle = '#ff8844';
  ctx.fillText('\u25CF MLE (latest obs)', 110, 12);
  ctx.fillStyle = '#556677';
  ctx.fillText('Turn', W / 2, H - 4);
}

// ── Entropy chart ──────────────────────────────────────────────
function drawEntropyChart(game) {
  const canvas = document.getElementById('summary-entropy-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const data = game.entropyHistory;
  if (data.length < 2) return;
  const maxH = Math.max(...data) * 1.1 + 0.1;
  const n = data.length;

  ctx.beginPath();
  ctx.moveTo(0, H - 15);
  for (let i = 0; i < n; i++) ctx.lineTo((i / (n - 1)) * W, H - 15 - (data[i] / maxH) * (H - 25));
  ctx.lineTo(W, H - 15);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 100, 170, 0.12)';
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * W, y = H - 15 - (data[i] / maxH) * (H - 25);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#ff66aa';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#ff66aa';
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`Peak: ${Math.max(...data).toFixed(1)} bits`, 10, 14);
  ctx.fillText(`Final: ${data[data.length - 1].toFixed(1)} bits`, 10, 26);
  ctx.fillStyle = '#556677';
  ctx.textAlign = 'center';
  ctx.fillText('Turn', W / 2, H - 2);
}

// ── Bootstrap chart ────────────────────────────────────────────
function drawBootstrapChart(game) {
  const canvas = document.getElementById('summary-bootstrap-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const boot = bootstrapCI(game.bayesErrors);
  if (!boot) {
    ctx.fillStyle = '#556677';
    ctx.font = '12px monospace';
    ctx.fillText('Not enough data', W / 2, H / 2);
    return;
  }

  const samples = boot.samples;
  const bins = 25;
  const lo = Math.min(...samples), hi = Math.max(...samples);
  const range = hi - lo || 1;
  const counts = new Array(bins).fill(0);
  for (const s of samples) counts[Math.min(bins - 1, Math.floor((s - lo) / range * bins))]++;
  const maxC = Math.max(...counts);
  const barW = W / bins;

  for (let i = 0; i < bins; i++) {
    const barH = (counts[i] / maxC) * (H - 35);
    ctx.fillStyle = '#44aaff44';
    ctx.fillRect(i * barW + 1, H - 20 - barH, barW - 2, barH);
    ctx.strokeStyle = '#44aaff88';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(i * barW + 1, H - 20 - barH, barW - 2, barH);
  }

  // Gaussian overlay
  const mu = boot.mean;
  const sigma = Math.sqrt(samples.reduce((a, s) => a + (s - mu) ** 2, 0) / samples.length);
  if (sigma > 0) {
    ctx.beginPath();
    for (let px = 0; px < W; px++) {
      const x = lo + (px / W) * range;
      const y = gaussianPDF(x, mu, sigma);
      const normY = y * (H - 35) * range / bins * samples.length / maxC;
      px === 0 ? ctx.moveTo(px, H - 20 - normY) : ctx.lineTo(px, H - 20 - normY);
    }
    ctx.strokeStyle = '#ffffffaa';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // CI lines
  for (const lx of [((boot.lo - lo) / range) * W, ((boot.hi - lo) / range) * W]) {
    ctx.strokeStyle = '#ff664488';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, H - 20); ctx.stroke();
  }

  ctx.fillStyle = '#44aaff';
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`\u03bc=${mu.toFixed(3)}  95% CI: [${boot.lo.toFixed(3)}, ${boot.hi.toFixed(3)}]`, 10, 14);
  ctx.fillStyle = '#778899';
  ctx.textAlign = 'center';
  ctx.fillText('Bootstrap means (CLT \u2192 Gaussian)', W / 2, H - 4);
}

// ── Replay system ──────────────────────────────────────────────
function initReplay(game) {
  replayIdx = 0;
  replayStage = 2; // start showing posterior
  stopAutoReplay();

  const history = game.history;
  if (history.length === 0) return;

  drawReplayFrame(game);

  // Button handlers
  const prevBtn = document.getElementById('replay-prev');
  const nextBtn = document.getElementById('replay-next');
  const playBtn = document.getElementById('replay-play');

  if (prevBtn) prevBtn.onclick = () => { replayIdx = Math.max(0, replayIdx - 1); drawReplayFrame(game); };
  if (nextBtn) nextBtn.onclick = () => { replayIdx = Math.min(history.length - 1, replayIdx + 1); drawReplayFrame(game); };
  if (playBtn) playBtn.onclick = () => {
    if (replayAutoPlay) {
      stopAutoReplay();
      playBtn.textContent = '\u25B6 Auto';
    } else {
      replayAutoPlay = true;
      playBtn.textContent = '\u23F8 Pause';
      replayInterval = setInterval(() => {
        // Cycle through stages, then advance turn
        replayStage++;
        if (replayStage > 2) {
          replayStage = 0;
          replayIdx++;
          if (replayIdx >= history.length) {
            replayIdx = history.length - 1;
            replayStage = 2;
            stopAutoReplay();
            playBtn.textContent = '\u25B6 Auto';
            return;
          }
        }
        drawReplayFrame(game);
      }, 800);
    }
  };

  // Stage buttons
  document.querySelectorAll('.replay-stage-btn').forEach(btn => {
    btn.onclick = () => {
      replayStage = parseInt(btn.dataset.stage);
      drawReplayFrame(game);
    };
  });
}

function stopAutoReplay() {
  replayAutoPlay = false;
  if (replayInterval) { clearInterval(replayInterval); replayInterval = null; }
}

function drawReplayFrame(game) {
  const canvas = document.getElementById('replay-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const snap = game.history[replayIdx];
  if (!snap) return;

  const S = W / GRID;

  // Choose which data to display
  let data, stageLabel;
  if (replayStage === 0 && snap.priorBelief) {
    data = snap.priorBelief;
    stageLabel = 'Prior (after prediction)';
  } else if (replayStage === 1 && snap.likelihood) {
    data = snap.likelihood;
    stageLabel = 'Likelihood L(z | cell)';
  } else {
    data = snap.posteriorBelief;
    stageLabel = 'Posterior = Prior \u00d7 Likelihood';
    replayStage = 2;
  }

  // Find max for color scaling
  let maxV = 0;
  for (let i = 0; i < data.length; i++) maxV = Math.max(maxV, data[i]);

  // Draw grid
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const idx = r * GRID + c;
      if (game.walls.has(idx)) {
        ctx.fillStyle = '#111122';
      } else {
        const t = maxV > 0 ? data[idx] / maxV : 0;
        if (replayStage === 1) {
          // Likelihood: cyan-white color
          ctx.fillStyle = `rgb(${Math.floor(20 + t * 60)},${Math.floor(30 + t * 200)},${Math.floor(50 + t * 205)})`;
        } else {
          // Prior/Posterior: orange-red
          ctx.fillStyle = `rgb(${Math.floor(30 + t * 225)},${Math.floor(15 + (1 - t) * 30)},${Math.floor(80 * (1 - t))})`;
        }
      }
      ctx.fillRect(c * S, r * S, S, S);
    }
  }

  // Player position
  ctx.fillStyle = '#00ffbb';
  ctx.beginPath();
  ctx.arc(snap.playerC * S + S / 2, snap.playerR * S + S / 2, S * 0.35, 0, Math.PI * 2);
  ctx.fill();

  // Monster positions (ground truth)
  for (const m of snap.monsters) {
    ctx.fillStyle = '#ff334488';
    ctx.beginPath();
    ctx.arc(m.c * S + S / 2, m.r * S + S / 2, S * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bayes estimate
  ctx.strokeStyle = '#44aaff';
  ctx.lineWidth = 2;
  ctx.strokeRect(snap.bayesEst.c * S + 2, snap.bayesEst.r * S + 2, S - 4, S - 4);

  // MLE estimate
  ctx.strokeStyle = '#ff8844';
  ctx.lineWidth = 1.5;
  const mx = snap.mleEst.c * S + S / 2, my = snap.mleEst.r * S + S / 2;
  const sz = S * 0.25;
  ctx.beginPath();
  ctx.moveTo(mx - sz, my - sz); ctx.lineTo(mx + sz, my + sz);
  ctx.moveTo(mx + sz, my - sz); ctx.lineTo(mx - sz, my + sz);
  ctx.stroke();

  // Update labels
  const label = document.getElementById('replay-label');
  if (label) label.textContent = `Turn ${replayIdx + 1} / ${game.history.length}  |  d\u2248${snap.reading.toFixed(1)}  H=${snap.entropy.toFixed(1)}`;
  const sLabel = document.getElementById('stage-label');
  if (sLabel) sLabel.textContent = stageLabel;

  // Highlight active stage button
  document.querySelectorAll('.replay-stage-btn').forEach((btn, i) => {
    btn.style.background = i === replayStage ? '#335577' : '#22445588';
    btn.style.borderColor = i === replayStage ? '#66ddff' : '#3366aa';
  });
}
