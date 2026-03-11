/* ============================================================
   SIDE PANELS — CS109 concept visualizations
   ============================================================ */

import { GRID, CELLS, gaussianPDF, betaPDF, bootstrapCI } from './math.js';
import { evColor } from './renderer.js';

// --- Belief minimap ---
export function drawBeliefMap(game) {
  const canvas = document.getElementById('belief-canvas');
  const ctx = canvas.getContext('2d');
  const S = canvas.width / GRID;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let maxB = 0;
  for (let i = 0; i < CELLS; i++) maxB = Math.max(maxB, game.belief[i]);

  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const idx = r * GRID + c;
      if (game.walls.has(idx)) {
        ctx.fillStyle = '#111122';
      } else {
        const t = maxB > 0 ? game.belief[idx] / maxB : 0;
        ctx.fillStyle = `rgb(${Math.floor(30 + t * 225)},${Math.floor(15 + (1 - t) * 30)},${Math.floor(80 * (1 - t))})`;
      }
      ctx.fillRect(c * S, r * S, S, S);
    }
  }

  ctx.fillStyle = '#00ffbb';
  ctx.beginPath();
  ctx.arc(game.player.c * S + S / 2, game.player.r * S + S / 2, S * 0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffcc00';
  ctx.fillRect(game.exit.c * S + 2, game.exit.r * S + 2, S - 4, S - 4);
}

// --- Entropy chart ---
export function drawEntropy(game) {
  const canvas = document.getElementById('entropy-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const data = game.entropyHistory;
  if (data.length < 2) return;

  const maxH = Math.max(...data) * 1.1 + 0.1;
  const n = data.length;

  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let i = 0; i < n; i++) {
    ctx.lineTo((i / (n - 1)) * W, H - (data[i] / maxH) * H);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 100, 170, 0.15)';
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * W, y = H - (data[i] / maxH) * H;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#ff66aa';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#ff66aa';
  ctx.font = '11px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${data[data.length - 1].toFixed(1)} bits`, W - 4, 14);
}

// --- Beta distribution ---
export function drawBeta(game) {
  const canvas = document.getElementById('beta-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const a = game.betaA, b = game.betaB;
  const nPts = 100;
  const vals = [];
  let maxY = 0;
  for (let i = 0; i <= nPts; i++) {
    const x = i / nPts;
    const y = betaPDF(x || 0.001, a, b);
    vals.push(y);
    if (y > maxY) maxY = y;
  }
  maxY *= 1.1;

  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let i = 0; i <= nPts; i++) ctx.lineTo((i / nPts) * W, H - (vals[i] / maxY) * H);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = 'rgba(100, 180, 255, 0.2)';
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i <= nPts; i++) {
    const x = (i / nPts) * W, y = H - (vals[i] / maxY) * H;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#66aaff';
  ctx.lineWidth = 2;
  ctx.stroke();

  const mean = a / (a + b);
  ctx.strokeStyle = '#ffffff44';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(mean * W, 0);
  ctx.lineTo(mean * W, H);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#88bbff';
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`E[p]=${mean.toFixed(2)}  \u03b1=${a.toFixed(1)} \u03b2=${b.toFixed(1)}`, 4, 14);
}

// --- EV arrows ---
export function drawEV(game) {
  const ev = game.computeEV();
  const vals = Object.values(ev).filter(v => v >= 0);
  const maxEV = vals.length > 0 ? Math.max(...vals) : 1;

  for (const [dir, id] of [['up', 'ev-up'], ['down', 'ev-down'], ['left', 'ev-left'], ['right', 'ev-right']]) {
    const el = document.getElementById(id);
    el.style.background = evColor(ev[dir], maxEV);
    el.style.color = ev[dir] < 0 ? '#333' : '#fff';
    if (ev[dir] >= 0) el.title = `EV(danger) = ${ev[dir].toFixed(4)}`;
  }
}

// --- Info gain ---
export function drawInfoGain(game) {
  const canvas = document.getElementById('infogain-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (game.phase !== 'PLAYING' && game.phase !== 'TUTORIAL') return;

  const gains = game.computeInfoGain();
  const labels = Object.keys(gains);
  const vals = Object.values(gains);
  const maxG = Math.max(...vals) * 1.2 + 0.01;
  const barW = W / labels.length - 6;

  for (let i = 0; i < labels.length; i++) {
    const x = i * (W / labels.length) + 3;
    const barH = (vals[i] / maxG) * (H - 24);
    const isScan = labels[i] === 'Scan';

    ctx.fillStyle = isScan ? '#22ccaa55' : '#44668855';
    ctx.fillRect(x, H - 18 - barH, barW, barH);
    ctx.strokeStyle = isScan ? '#22ccaa' : '#446688';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, H - 18 - barH, barW, barH);

    ctx.fillStyle = '#778899';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(labels[i].replace('Move ', ''), x + barW / 2, H - 4);
    ctx.fillStyle = '#aabbcc';
    ctx.fillText(vals[i].toFixed(2), x + barW / 2, H - 22 - barH);
  }
}

// --- Markov chain transition matrix heatmap ---
export function drawMarkovMatrix(audioState) {
  const canvas = document.getElementById('markov-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const { noteNames, currentNote, tension, matrix } = audioState;
  const n = noteNames.length;
  const cellW = (W - 30) / n;
  const cellH = (H - 30) / n;
  const offsetX = 25, offsetY = 18;

  // Column headers
  ctx.fillStyle = '#667788';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  for (let j = 0; j < n; j++) {
    ctx.fillText(noteNames[j], offsetX + j * cellW + cellW / 2, offsetY - 4);
  }

  // Rows
  for (let i = 0; i < n; i++) {
    // Row label
    ctx.fillStyle = i === currentNote ? '#66ddff' : '#556677';
    ctx.textAlign = 'right';
    ctx.fillText(noteNames[i], offsetX - 3, offsetY + i * cellH + cellH / 2 + 3);

    for (let j = 0; j < n; j++) {
      const val = matrix[i][j];
      const t = Math.min(1, val / 0.35);
      const x = offsetX + j * cellW;
      const y = offsetY + i * cellH;

      // Cell color
      ctx.fillStyle = `rgba(100, 180, 255, ${t * 0.8})`;
      ctx.fillRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);

      // Highlight current row
      if (i === currentNote) {
        ctx.strokeStyle = '#66ddff44';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
      }
    }
  }

  // Tension label
  ctx.fillStyle = '#667788';
  ctx.textAlign = 'left';
  ctx.font = '9px monospace';
  ctx.fillText(`Tension: ${(tension * 100).toFixed(0)}%`, 2, H - 3);
  ctx.textAlign = 'right';
  ctx.fillText(`Note: ${noteNames[currentNote]}`, W - 2, H - 3);
}

// --- Post-game stats ---
export function drawPostGame(game) {
  const statsDiv = document.getElementById('postgame-stats');
  const canvas = document.getElementById('postgame-canvas');

  if (game.phase !== 'WON' && game.phase !== 'LOST') {
    statsDiv.textContent = 'Complete a game to see analysis.';
    canvas.classList.add('hidden');
    return;
  }

  canvas.classList.remove('hidden');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const errors = game.sensorErrors;
  if (errors.length < 5) {
    statsDiv.innerHTML = '<strong>Not enough data</strong>';
    return;
  }

  const boot = bootstrapCI(errors);
  statsDiv.innerHTML =
    `<strong>${game.phase === 'WON' ? 'Victory!' : 'Defeated'}</strong> in ${game.turn} turns<br>` +
    `Mean sensor error: <strong>${boot.mean.toFixed(3)}</strong><br>` +
    `95% Bootstrap CI: [${boot.lo.toFixed(3)}, ${boot.hi.toFixed(3)}]<br>` +
    `<span style="color:#667">n=${errors.length}, 400 resamples</span>`;

  const samples = boot.samples;
  const bins = 20;
  const lo = Math.min(...samples), hi = Math.max(...samples);
  const range = hi - lo || 1;
  const counts = new Array(bins).fill(0);
  for (const s of samples) counts[Math.min(bins - 1, Math.floor((s - lo) / range * bins))]++;
  const maxC = Math.max(...counts);
  const barW = W / bins;

  for (let i = 0; i < bins; i++) {
    const barH = (counts[i] / maxC) * (H - 30);
    ctx.fillStyle = '#44aaff55';
    ctx.fillRect(i * barW + 1, H - 20 - barH, barW - 2, barH);
    ctx.strokeStyle = '#44aaff';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(i * barW + 1, H - 20 - barH, barW - 2, barH);
  }

  // Gaussian overlay (CLT!)
  const mu = boot.mean;
  const sigma = Math.sqrt(samples.reduce((a, s) => a + (s - mu) ** 2, 0) / samples.length);
  if (sigma > 0) {
    ctx.beginPath();
    for (let px = 0; px < W; px++) {
      const x = lo + (px / W) * range;
      const y = gaussianPDF(x, mu, sigma);
      const normY = y * (H - 30) * range / bins * samples.length / maxC;
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
    ctx.beginPath();
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx, H - 20);
    ctx.stroke();
  }

  ctx.fillStyle = '#778899';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Bootstrap means (CLT \u2192 Gaussian)', W / 2, H - 4);
}

// --- Update stats UI ---
export function updateUI(game) {
  const hearts = game.lives > 0 ? '\u2665'.repeat(game.lives) : '\u2661';
  document.getElementById('lives').textContent = hearts;
  document.getElementById('lives').style.color = game.lives > 1 ? '#ff4466' : '#ff2222';
  document.getElementById('turn').textContent = game.turn;
  document.getElementById('monsters-left').textContent =
    game.phase === 'PLAYING' || game.phase === 'TUTORIAL' ? '?' : game.monsters.length;
  document.getElementById('sensor-reading').textContent =
    game.lastReading !== null ? `d\u2248${game.lastReading.toFixed(1)}` : '\u2014';
  const reliability = game.betaA / (game.betaA + game.betaB);
  document.getElementById('scan-fill').style.width = `${reliability * 100}%`;

  // Turns remaining
  const remaining = game.turnsRemaining();
  const tlEl = document.getElementById('turns-left');
  if (tlEl) {
    tlEl.textContent = remaining === Infinity ? '\u221e' : remaining;
    tlEl.style.color = remaining <= 10 ? '#ff3344' : remaining <= 20 ? '#ff8844' : '#aaccff';
  }
}
