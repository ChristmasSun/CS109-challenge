/* ============================================================
   GAME STATE — Core game logic + Bayesian inference engine
   ============================================================ */

import {
  GRID, CELLS, randn, gaussianPDF, shannonEntropy,
  dist, convolve2D, makeMotionKernel, normalize
} from './math.js';
import { audio } from './audio.js';

// ── Level definitions ──────────────────────────────────────────
export const LEVELS = [
  { name: 'Training Ground', monsters: 4,  sensorSigma: 2.0, motionProb: 0.35, walls: 18, turnLimit: 80,  hunterProb: 0    },
  { name: 'The Depths',      monsters: 6,  sensorSigma: 2.5, motionProb: 0.45, walls: 22, turnLimit: 70,  hunterProb: 0.15 },
  { name: 'Dark Labyrinth',  monsters: 8,  sensorSigma: 3.0, motionProb: 0.55, walls: 28, turnLimit: 65,  hunterProb: 0.25 },
  { name: 'The Abyss',       monsters: 10, sensorSigma: 3.5, motionProb: 0.65, walls: 30, turnLimit: 55,  hunterProb: 0.35 },
  { name: 'Nightmare',       monsters: 13, sensorSigma: 4.0, motionProb: 0.75, walls: 35, turnLimit: 50,  hunterProb: 0.50 },
];

const SCAN_SIGMA_MULT = 0.5;

export class GameState {
  constructor() {
    this.currentLevel = 0;
    this.reset();
  }

  reset() {
    const lvl = LEVELS[this.currentLevel] || LEVELS[LEVELS.length - 1];

    this.phase = 'TITLE';   // TITLE, TUTORIAL, PLAYING, WON, LOST
    this.lives = 2;
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
    this.levelConfig = lvl;

    // MLE tracking
    this.mleEstimate = { r: GRID / 2, c: GRID / 2 };
    this.mleErrors = [];
    this.bayesErrors = [];

    // Scoring
    this.moveCount = 0;
    this.scanCount = 0;
    this.evFollowCount = 0;
    this.monstersDefeated = 0;

    // Turn history for replay
    this.history = [];

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

  nextLevel() {
    if (this.currentLevel < LEVELS.length - 1) this.currentLevel++;
    this.reset();
  }

  _generateDungeon() {
    this.walls.clear();
    this.monsters = [];
    const lvl = this.levelConfig;

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

    // Interior walls (scaled by level)
    const nWalls = lvl.walls + Math.floor(Math.random() * 10);
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

    // Place monsters — half near the diagonal path, half random
    const diagMonsters = Math.ceil(lvl.monsters * 0.5);
    const randMonsters = lvl.monsters - diagMonsters;

    // Diagonal-biased monsters: placed within 3 cells of the direct path
    for (let m = 0; m < diagMonsters; m++) {
      let mr, mc, tries = 0;
      do {
        // Pick a random point along the diagonal and offset slightly
        const t = 0.2 + Math.random() * 0.7; // avoid start/end zones
        const baseR = Math.round(this.player.r + t * (this.exit.r - this.player.r));
        const baseC = Math.round(this.player.c + t * (this.exit.c - this.player.c));
        mr = Math.max(1, Math.min(GRID - 2, baseR + Math.floor(Math.random() * 5) - 2));
        mc = Math.max(1, Math.min(GRID - 2, baseC + Math.floor(Math.random() * 5) - 2));
        tries++;
      } while (tries < 200 && (
        this.walls.has(mr * GRID + mc) ||
        dist(mr, mc, this.player.r, this.player.c) < 4 ||
        dist(mr, mc, this.exit.r, this.exit.c) < 2 ||
        this.monsters.some(e => e.r === mr && e.c === mc)
      ));
      if (tries < 200) this.monsters.push({ r: mr, c: mc });
    }

    // Remaining monsters: fully random
    for (let m = 0; m < randMonsters; m++) {
      let mr, mc, tries = 0;
      do {
        mr = 1 + Math.floor(Math.random() * (GRID - 2));
        mc = 1 + Math.floor(Math.random() * (GRID - 2));
        tries++;
      } while (tries < 200 && (
        this.walls.has(mr * GRID + mc) ||
        dist(mr, mc, this.player.r, this.player.c) < 4 ||
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

  // MAP estimate from belief grid
  bayesEstimate() {
    let maxIdx = 0;
    for (let i = 1; i < CELLS; i++) {
      if (this.belief[i] > this.belief[maxIdx]) maxIdx = i;
    }
    return { r: Math.floor(maxIdx / GRID), c: maxIdx % GRID };
  }

  // MLE estimate: argmax of likelihood from current reading only (no prior)
  _computeMLE(reading, sigma) {
    let bestIdx = 0, bestL = -1;
    for (let i = 0; i < CELLS; i++) {
      if (this.walls.has(i)) continue;
      const r = Math.floor(i / GRID), c = i % GRID;
      const d = dist(this.player.r, this.player.c, r, c);
      const l = gaussianPDF(reading, d, sigma);
      if (l > bestL) { bestL = l; bestIdx = i; }
    }
    return { r: Math.floor(bestIdx / GRID), c: bestIdx % GRID };
  }

  // --- Sonar ping (observation) ---
  sonarPing(sigmaMultiplier = 1) {
    const trueDist = this.nearestMonsterDist();
    const sigma = this.levelConfig.sensorSigma * sigmaMultiplier *
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
    // Store pre-update belief for replay
    this._lastPriorBelief = new Float64Array(this.belief);

    // Compute and store likelihood
    this._lastLikelihood = new Float64Array(CELLS);
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const idx = r * GRID + c;
        if (this.walls.has(idx)) continue;
        const d = dist(this.player.r, this.player.c, r, c);
        const l = gaussianPDF(reading, d, sigma);
        this._lastLikelihood[idx] = l;
        this.belief[idx] *= l;
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
    const prob = this.levelConfig.motionProb;
    const hunterProb = this.levelConfig.hunterProb || 0;
    for (const m of this.monsters) {
      if (Math.random() < prob) {
        let dirs;
        if (Math.random() < hunterProb) {
          // Hunter behavior: bias movement toward the player
          dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
          dirs.sort((a, b) => {
            const da = dist(m.r + a[0], m.c + a[1], this.player.r, this.player.c);
            const db = dist(m.r + b[0], m.c + b[1], this.player.r, this.player.c);
            return da - db;  // prefer moves that get closer
          });
        } else {
          dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]].sort(() => Math.random() - 0.5);
        }
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
      const sigma = this.levelConfig.sensorSigma * sigmaMult;
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

  // --- Scoring ---
  computeScore() {
    const lvlIdx = this.currentLevel;
    const baseTurns = GRID * 2;
    const turnScore = Math.max(0, 50 - Math.max(0, this.turn - baseTurns) * 1.0);
    const liveScore = this.lives * 60;  // 120 max (2 lives), 0 if dead
    const hitPenalty = (2 - this.lives) * 30; // extra penalty per hit
    const evRatio = this.moveCount > 0 ? this.evFollowCount / this.moveCount : 0;
    const evScore = evRatio * 30;
    const scanBonus = Math.min(10, this.scanCount * 2);
    const raw = Math.max(0, turnScore + liveScore + evScore + scanBonus - hitPenalty);
    const multiplier = 1 + lvlIdx * 0.25;
    return Math.round(raw * multiplier);
  }

  getGrade(score) {
    if (score >= 220) return 'S';
    if (score >= 185) return 'A+';
    if (score >= 155) return 'A';
    if (score >= 130) return 'B+';
    if (score >= 105) return 'B';
    if (score >= 80)  return 'C+';
    if (score >= 55)  return 'C';
    if (score >= 30)  return 'D';
    return 'F';
  }

  // --- Particles ---
  spawnSonarParticles() {
    const pr = this.player.r, pc = this.player.c;
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const speed = 1.5 + Math.random() * 1.5;
      this.particles.push({
        x: pc, y: pr,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1.0, decay: 0.015 + Math.random() * 0.01, color: 'sonar'
      });
    }
  }

  spawnHitParticles(r, c) {
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2;
      this.particles.push({
        x: c, y: r,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1.0, decay: 0.03 + Math.random() * 0.02, color: 'hit'
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

  // --- Save turn snapshot for replay ---
  _saveSnapshot(reading, sigma) {
    // Find nearest monster for error tracking
    let nearestR = Infinity, nearestC = 0, nearestDist = Infinity;
    for (const m of this.monsters) {
      const d = dist(this.player.r, this.player.c, m.r, m.c);
      if (d < nearestDist) { nearestDist = d; nearestR = m.r; nearestC = m.c; }
    }

    const bayesEst = this.bayesEstimate();
    const errBayes = this.monsters.length > 0
      ? dist(bayesEst.r, bayesEst.c, nearestR, nearestC) : 0;
    const errMLE = this.monsters.length > 0
      ? dist(this.mleEstimate.r, this.mleEstimate.c, nearestR, nearestC) : 0;

    this.bayesErrors.push(errBayes);
    this.mleErrors.push(errMLE);

    this.history.push({
      turn: this.turn,
      playerR: this.player.r,
      playerC: this.player.c,
      reading,
      sigma,
      entropy: this.entropyHistory[this.entropyHistory.length - 1],
      bayesEst: { ...bayesEst },
      mleEst: { ...this.mleEstimate },
      errBayes,
      errMLE,
      priorBelief: this._lastPriorBelief ? new Float64Array(this._lastPriorBelief) : null,
      likelihood: this._lastLikelihood ? new Float64Array(this._lastLikelihood) : null,
      posteriorBelief: new Float64Array(this.belief),
      monsters: this.monsters.map(m => ({ ...m })),
    });
  }

  // --- Execute a full turn ---
  doTurn(dr, dc, isScan = false) {
    if (this.phase !== 'PLAYING' && this.phase !== 'TUTORIAL') return;

    // Track EV following for scoring
    if (!isScan && (dr !== 0 || dc !== 0)) {
      const ev = this.computeEV();
      const dirName = dr === -1 ? 'up' : dr === 1 ? 'down' : dc === -1 ? 'left' : 'right';
      const validEVs = Object.entries(ev).filter(([, v]) => v >= 0);
      if (validEVs.length > 0) {
        const safest = validEVs.reduce((a, b) => a[1] < b[1] ? a : b)[0];
        if (dirName === safest) this.evFollowCount++;
      }
      this.moveCount++;
    }
    if (isScan) this.scanCount++;

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
        this.monstersDefeated++;
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

    // Bayesian cycle: predict → observe → update
    this.predict();
    const sigmaMult = isScan ? SCAN_SIGMA_MULT : 1;
    const { reading, sigma } = this.sonarPing(sigmaMult);
    this.update(reading, sigma);

    // Scanning: second reading at half noise for double information
    if (isScan) {
      const ping2 = this.sonarPing(SCAN_SIGMA_MULT);
      this.update(ping2.reading, ping2.sigma);
    }

    // MLE estimate (current observation only, no prior)
    this.mleEstimate = this._computeMLE(reading, sigma);

    this.entropyHistory.push(shannonEntropy(this.belief));
    this.sonarAnim = 1.0;
    this.spawnSonarParticles();

    // Save snapshot for replay
    this._saveSnapshot(reading, sigma);

    // Update music tension
    if (this.entropyHistory.length > 0) {
      const maxEntropy = Math.log2(CELLS);
      const currentEntropy = this.entropyHistory[this.entropyHistory.length - 1];
      audio.setTension(currentEntropy / maxEntropy);
    }

    // Turn limit
    if (this.levelConfig.turnLimit && this.turn >= this.levelConfig.turnLimit) {
      this.phase = 'LOST';
      audio.stopMusic();
    }
  }

  turnsRemaining() {
    return this.levelConfig.turnLimit ? this.levelConfig.turnLimit - this.turn : Infinity;
  }
}
