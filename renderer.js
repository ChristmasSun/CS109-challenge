/* ============================================================
   RENDERER — Game canvas + smooth animations + particles
   ============================================================ */

import { GRID, CELL_PX, CANVAS_PX, dist } from './math.js';

// Smooth interpolation rate (0-1 per frame, higher = snappier)
const LERP_RATE = 0.25;

function lerp(a, b, t) { return a + (b - a) * t; }

function beliefColor(p, maxP) {
  if (maxP < 1e-12) return 'rgba(0,0,0,0)';
  const t = Math.min(1, p / maxP);
  const r = Math.floor(40 + t * 215);
  const g = Math.floor(20 + (1 - Math.abs(t - 0.4) * 2) * 80);
  const b = Math.floor(30 * (1 - t));
  const a = t * 0.65;
  return `rgba(${r},${g},${b},${a})`;
}

export function evColor(val, maxVal) {
  if (val < 0) return '#1a1a2a';
  const t = maxVal > 0 ? Math.min(1, val / maxVal) : 0;
  const r = Math.floor(40 + t * 200);
  const g = Math.floor(200 - t * 180);
  return `rgb(${r},${g},60)`;
}

export function drawGame(ctx, game) {
  const S = CELL_PX;

  // Smooth player position
  game.playerRenderR = lerp(game.playerRenderR, game.player.r, LERP_RATE);
  game.playerRenderC = lerp(game.playerRenderC, game.player.c, LERP_RATE);

  // Screen shake
  let sx = 0, sy = 0;
  if (game.shakeFrames > 0) {
    sx = (Math.random() - 0.5) * 8;
    sy = (Math.random() - 0.5) * 8;
  }

  ctx.save();
  ctx.translate(sx, sy);
  ctx.clearRect(-10, -10, CANVAS_PX + 20, CANVAS_PX + 20);

  let maxB = 0;
  for (let i = 0; i < game.belief.length; i++) maxB = Math.max(maxB, game.belief[i]);

  // --- Grid tiles ---
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const x = c * S, y = r * S;
      const idx = r * GRID + c;
      const isWall = game.walls.has(idx);
      const isVisited = game.visited.has(idx);

      // Fog gradient based on distance from player
      const dToPlayer = dist(game.player.r, game.player.c, r, c);
      const fogAlpha = isVisited ? 0 : Math.min(1, Math.max(0, (dToPlayer - 3) / 5));

      if (isWall) {
        ctx.fillStyle = '#161628';
        ctx.fillRect(x, y, S, S);
        ctx.fillStyle = '#1e1e38';
        ctx.fillRect(x + 2, y + 2, S - 4, S - 4);
      } else {
        // Base floor
        ctx.fillStyle = '#121225';
        ctx.fillRect(x, y, S, S);

        // Belief heatmap
        const bColor = beliefColor(game.belief[idx], maxB);
        ctx.fillStyle = bColor;
        ctx.fillRect(x, y, S, S);

        // Fog overlay (gradient)
        if (fogAlpha > 0) {
          ctx.fillStyle = `rgba(8, 8, 26, ${fogAlpha * 0.7})`;
          ctx.fillRect(x, y, S, S);
        }
      }

      // Subtle grid lines
      ctx.strokeStyle = '#15152a';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, S, S);
    }
  }

  // --- Exit marker ---
  {
    const ex = game.exit.c * S, ey = game.exit.r * S;
    ctx.fillStyle = '#ffcc0022';
    ctx.fillRect(ex + 2, ey + 2, S - 4, S - 4);
    ctx.strokeStyle = '#ffcc0066';
    ctx.lineWidth = 1;
    ctx.strokeRect(ex + 3, ey + 3, S - 6, S - 6);
    ctx.fillStyle = '#ffcc00';
    ctx.font = `bold ${S * 0.45}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EXIT', ex + S / 2, ey + S / 2);
  }

  // --- Visible monsters ---
  for (const m of game.monsters) {
    if (game.visited.has(m.r * GRID + m.c)) {
      const mx = m.c * S + S / 2, my = m.r * S + S / 2;
      // Glow
      ctx.shadowColor = '#ff3344';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ff334488';
      ctx.beginPath();
      ctx.arc(mx, my, S * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff3344';
      ctx.font = `bold ${S * 0.5}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', mx, my);
    }
  }

  // --- Particles ---
  for (const p of game.particles) {
    const px = p.x * S + S / 2;
    const py = p.y * S + S / 2;
    const alpha = p.life * 0.8;
    const radius = p.color === 'sonar' ? 2 + (1 - p.life) * 2 : 3 * p.life;
    ctx.fillStyle = p.color === 'sonar'
      ? `rgba(0, 255, 187, ${alpha})`
      : `rgba(255, 60, 60, ${alpha})`;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Sonar ring animation ---
  if (game.sonarAnim > 0.01) {
    const px = game.playerRenderC * S + S / 2;
    const py = game.playerRenderR * S + S / 2;
    const maxRadius = (game.lastReading || 3) * S;
    const progress = 1 - game.sonarAnim;
    const radius = maxRadius * progress + S;
    const alpha = game.sonarAnim * 0.35;

    ctx.strokeStyle = `rgba(0, 255, 187, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Secondary ring
    ctx.strokeStyle = `rgba(100, 220, 255, ${alpha * 0.4})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px, py, radius * 0.65, 0, Math.PI * 2);
    ctx.stroke();
  }

  // --- Player (smooth position) ---
  {
    const px = game.playerRenderC * S + S / 2;
    const py = game.playerRenderR * S + S / 2;

    // Outer glow
    ctx.shadowColor = '#00ffbb';
    ctx.shadowBlur = 15;
    ctx.fillStyle = '#00ffbb';
    ctx.beginPath();
    ctx.arc(px, py, S * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Inner bright dot
    ctx.fillStyle = '#ccffee';
    ctx.beginPath();
    ctx.arc(px, py, S * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Sensor reading label ---
  if (game.lastReading !== null && (game.phase === 'PLAYING' || game.phase === 'TUTORIAL')) {
    const px = game.playerRenderC * S + S / 2;
    const py = game.playerRenderR * S - 8;
    ctx.fillStyle = '#66ddffaa';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`d\u2248${game.lastReading.toFixed(1)}`, px, py);
  }

  ctx.restore();
}
