/* ============================================================
   GAME STATE — Core game logic + Bayesian inference engine
   ============================================================ */

import {
  GRID, CELLS, randn, gaussianPDF, shannonEntropy,
  dist, convolve2D, makeMotionKernel, normalize
} from './math.js';
import { audio } from './audio.js';

const MOTION_PROB = 0.35;
const BASE_SENSOR_SIGMA = 2.0;
const SCAN_SIGMA_MULT = 0.5;

export class GameState {
  constructor() { this.reset(); }

  reset() {
    this.phase = 'TITLE';   // TITLE, TUTORIAL, PLAYING, WON, LOST
    this.lives = 3;
    this.turn = 0;
    this.player = { r: 1, c: 1 };
    this.exit = { r: GRID - 2, c: GRID - 2 };
    this.walls = new Set();
    this.monsters = [];
    this.belief = new Float64Array(CELLS);
    this.visited = new Set();
    this.betaA = 2;
    this.betaB = 2;
    this.entropyHistory = [];
    this.sensorErrors = [];
    this.lastReading = null;
    this.lastTrueNearest = null;
    this.motionKernel = makeMotionKernel(1.2);

    // Animation state
    this.sonarAnim = 0;
    this.shakeFrames = 0;
    this.playerRenderR = 1;
    this.playerRenderC = 1;
    this.particles = [];

    // Tutorial state
    this.tutorialStep = 0;
    this.tutorialActive = false;

    this._generateDungeon();
    this._initBelief();
    this._revealAround(this.player.r, this.player.c);
  }

  _generateDungeon() {
    this.walls.clear();
    this.monsters = [];

    // Guaranteed path via biased random walk
    const path = new Set();
    let r = this.player.r, c = this.player.c;
    path.add(r * GRID + c);
    while (r !== this.exit.r || c !== this.exit.c) {
      const choices = [];
      if (r < this.exit.r) choices.push([r + 1, c], [r + 1, c]);
      if (r > this.exit.r) choices.push([r - 1, c]);
      if (c < this.exit.c) choices.push([r, c + 1], [r, c + 1]);
      if (c > this.exit.c) choices.push([r, c - 1]);
      if (r > 1) choices.push([r - 1, c]);
      if (r < GRID - 2) choices.push([r + 1, c]);
      if (c > 1) choices.push([r, c - 1]);
      if (c < GRID - 2) choices.push([r, c + 1]);
      const [nr, nc] = choices[Math.floor(Math.random() * choices.length)];
      r = Math.max(1, Math.min(GRID - 2, nr));
      c = Math.max(1, Math.min(GRID - 2, nc));
      path.add(r * GRID + c);
    }

    // Border walls
    for (let i = 0; i < GRID; i++) {
      this.walls.add(0 * GRID + i);
      this.walls.add((GRID - 1) * GRID + i);
      this.walls.add(i * GRID + 0);
      this.walls.add(i * GRID + (GRID - 1));
    }

    // Interior walls
    const nWalls = 20 + Math.floor(Math.random() * 15);
    for (let w = 0; w < nWalls; w++) {
      const wr = 1 + Math.floor(Math.random() * (GRID - 2));
      const wc = 1 + Math.floor(Math.random() * (GRID - 2));
      const idx = wr * GRID + wc;
      if (!path.has(idx) &&
          !(wr === this.player.r && wc === this.player.c) &&
          !(wr === this.exit.r && wc === this.exit.c)) {
        this.walls.add(idx);
      }
    }

    // Place monsters
    for (let m = 0; m < 4; m++) {
      let mr, mc, tries = 0;
      do {
        mr = 1 + Math.floor(Math.random() * (GRID - 2));
        mc = 1 + Math.floor(Math.random() * (GRID - 2));
        tries++;
      } while (tries < 200 && (
        this.walls.has(mr * GRID + mc) ||
        dist(mr, mc, this.player.r, this.player.c) < 5 ||
        dist(mr, mc, this.exit.r, this.exit.c) < 2 ||
        this.monsters.some(e => e.r === mr && e.c === mc)
      ));
      if (tries < 200) this.monsters.push({ r: mr, c: mc });
    }
  }

  _initBelief() {
    let nOpen = 0;
    for (let i = 0; i < CELLS; i++) if (!this.walls.has(i)) nOpen++;
    for (let i = 0; i < CELLS; i++) this.belief[i] = this.walls.has(i) ? 0 : 1 / nOpen;
  }

  _revealAround(r, c) {
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < GRID && nc >= 0 && nc < GRID && dist(r, c, nr, nc) <= 2.5) {
          this.visited.add(nr * GRID + nc);
        }
      }
    }
  }

  isWall(r, c) {
    return r < 0 || r >= GRID || c < 0 || c >= GRID || this.walls.has(r * GRID + c);
  }

  nearestMonsterDist() {
    let minD = Infinity;
    for (const m of this.monsters) {
      minD = Math.min(minD, dist(this.player.r, this.player.c, m.r, m.c));
    }
    return minD;
  }

  // --- Sonar ping (observation) ---
  sonarPing(sigmaMultiplier = 1) {
    const trueDist = this.nearestMonsterDist();
    const sigma = BASE_SENSOR_SIGMA * sigmaMultiplier *
                  (1.1 - this.betaA / (this.betaA + this.betaB) * 0.3);
    const reading = Math.max(0, trueDist + randn() * sigma);
    this.lastReading = reading;
    this.lastTrueNearest = trueDist;
    this.sensorErrors.push(Math.abs(reading - trueDist));

    // Beta update
    const error = Math.abs(reading - trueDist);
    const pGood = gaussianPDF(error, 0, sigma * 0.5);
    const pBad = 0.05;
    const w = pGood / (pGood + pBad + 1e-12);
    this.betaA += w;
    this.betaB += (1 - w);
    this.betaA = Math.max(1.01, this.betaA * 0.995);
    this.betaB = Math.max(1.01, this.betaB * 0.995);

    return { reading, sigma };
  }

  // --- Bayesian Prediction step ---
  predict() {
    this.belief = convolve2D(this.belief, this.motionKernel.data, this.motionKernel.size);
    for (let i = 0; i < CELLS; i++) {
      if (this.walls.has(i)) this.belief[i] = 0;
      if (this.belief[i] < 0) this.belief[i] = 0;
    }
    normalize(this.belief);
  }

  // --- Bayesian Update step ---
  update(reading, sigma) {
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const idx = r * GRID + c;
        if (this.walls.has(idx)) continue;
        const d = dist(this.player.r, this.player.c, r, c);
        this.belief[idx] *= gaussianPDF(reading, d, sigma);
      }
    }
    // Suppress visited cells with no monster
    for (const vi of this.visited) {
      const vr = Math.floor(vi / GRID), vc = vi % GRID;
      if (!this.monsters.some(m => m.r === vr && m.c === vc)) {
        this.belief[vi] *= 0.01;
      }
    }
    normalize(this.belief);
  }

  moveMonsters() {
    for (const m of this.monsters) {
      if (Math.random() < MOTION_PROB) {
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]].sort(() => Math.random() - 0.5);
        for (const [dr, dc] of dirs) {
          const nr = m.r + dr, nc = m.c + dc;
          if (!this.isWall(nr, nc) && !this.monsters.some(o => o !== m && o.r === nr && o.c === nc)) {
            m.r = nr; m.c = nc; break;
          }
        }
      }
    }
  }

  computeEV() {
    const dirs = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
    const ev = {};
    for (const [name, [dr, dc]] of Object.entries(dirs)) {
      const nr = this.player.r + dr, nc = this.player.c + dc;
      if (this.isWall(nr, nc)) { ev[name] = -1; continue; }
      let danger = 0;
      for (let r = Math.max(0, nr - 1); r <= Math.min(GRID - 1, nr + 1); r++) {
        for (let c = Math.max(0, nc - 1); c <= Math.min(GRID - 1, nc + 1); c++) {
          danger += this.belief[r * GRID + c] * ((r === nr && c === nc) ? 3 : 1);
        }
      }
      ev[name] = danger;
    }
    return ev;
  }

  computeInfoGain() {
    const currentH = shannonEntropy(this.belief);
    const actions = {
      'Move Up': [-1, 0, 1], 'Move Down': [1, 0, 1],
      'Move Left': [0, -1, 1], 'Move Right': [0, 1, 1],
      'Scan': [0, 0, SCAN_SIGMA_MULT]
    };
    const gains = {};
    for (const [name, [dr, dc, sigmaMult]] of Object.entries(actions)) {
      const nr = this.player.r + dr, nc = this.player.c + dc;
      if ((dr !== 0 || dc !== 0) && this.isWall(nr, nc)) { gains[name] = 0; continue; }
      let expReading = 0;
      for (let i = 0; i < CELLS; i++) {
        const r = Math.floor(i / GRID), c = i % GRID;
        expReading += this.belief[i] * dist(nr, nc, r, c);
      }
      const sigma = BASE_SENSOR_SIGMA * sigmaMult;
      const simBelief = new Float64Array(this.belief);
      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          simBelief[r * GRID + c] *= gaussianPDF(expReading, dist(nr, nc, r, c), sigma);
        }
      }
      normalize(simBelief);
      gains[name] = Math.max(0, currentH - shannonEntropy(simBelief));
    }
    return gains;
  }

  // --- Spawn particles ---
  spawnSonarParticles() {
    const pr = this.player.r, pc = this.player.c;
    for (let i = 0; i < 10; i++) {
      const angle = (i / 24) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const speed = 1.5 + Math.random() * 1.5;
      this.particles.push({
        x: pc, y: pr,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        decay: 0.015 + Math.random() * 0.01,
        color: 'sonar'
      });
    }
  }

  spawnHitParticles(r, c) {
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2;
      this.particles.push({
        x: c, y: r,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        decay: 0.03 + Math.random() * 0.02,
        color: 'hit'
      });
    }
  }

  updateParticles() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * 0.04;
      p.y += p.vy * 0.04;
      p.life -= p.decay;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  // --- Execute a full turn ---
  doTurn(dr, dc, isScan = false) {
    if (this.phase !== 'PLAYING' && this.phase !== 'TUTORIAL') return;

    if (!isScan) {
      const nr = this.player.r + dr, nc = this.player.c + dc;
      if (this.isWall(nr, nc)) return;
      this.player.r = nr;
      this.player.c = nc;
      this._revealAround(nr, nc);
      audio.step();

      // Monster collision
      const hitIdx = this.monsters.findIndex(m => m.r === nr && m.c === nc);
      if (hitIdx >= 0) {
        this.spawnHitParticles(nr, nc);
        this.monsters.splice(hitIdx, 1);
        this.lives--;
        this.shakeFrames = 12;
        audio.hit();
        if (this.lives <= 0) { this.phase = 'LOST'; audio.stopMusic(); return; }
      }

      // Exit
      if (nr === this.exit.r && nc === this.exit.c) {
        this.phase = 'WON'; audio.win(); audio.stopMusic(); return;
      }
    } else {
      audio.scan();
    }

    this.turn++;
    this.moveMonsters();

    // Bayesian cycle
    this.predict();
    const sigmaMult = isScan ? SCAN_SIGMA_MULT : 1;
    const { reading, sigma } = this.sonarPing(sigmaMult);
    this.update(reading, sigma);

    this.entropyHistory.push(shannonEntropy(this.belief));
    this.sonarAnim = 1.0;
    this.spawnSonarParticles();

    // Update music tension based on entropy
    if (this.entropyHistory.length > 0) {
      const maxEntropy = Math.log2(CELLS);
      const currentEntropy = this.entropyHistory[this.entropyHistory.length - 1];
      audio.setTension(currentEntropy / maxEntropy);
    }
  }
}
