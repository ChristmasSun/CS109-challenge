/* ============================================================
   TUTORIAL — Step-by-step Bayesian inference walkthrough
   ============================================================ */

const STEPS = [
  {
    title: 'Welcome!',
    text: `You're trapped in a dungeon. <strong>Monsters</strong> hide in the fog.
           Your only tool is a <strong>sonar sensor</strong> that estimates distance to the nearest monster, but it's noisy.`,
    math: null,
    highlight: null,
    highlightCanvas: 'game-canvas',
    action: 'next',
  },
  {
    title: 'Step 1: The Prior',
    text: `Before any observations, you have <strong>no idea</strong> where the monsters are.
           Your belief is <strong>uniform</strong>, meaning you think every cell is equally likely.
           Look at the Belief Map →`,
    math: 'P(monster at cell) = 1/N  for all open cells',
    highlight: 'belief-panel',
    highlightCanvas: null,
    action: 'next',
  },
  {
    title: 'Step 2: Observation',
    text: `Let's ping the sonar! You'll get a noisy distance reading.
           The reading = <strong>true distance + Gaussian noise</strong>.
           <br><br>Press <kbd>Space</kbd> to scan.`,
    math: 'z = d_true + \u03b5, &nbsp; \u03b5 ~ N(0, \u03c3\u00b2)',
    highlight: 'stats-panel',
    highlightCanvas: null,
    action: 'scan',
  },
  {
    title: 'Step 3: The Likelihood',
    text: `See the <strong style="color:#ff8855">ring</strong> on the heatmap? That's the <strong>likelihood function</strong>.
           Cells at distance \u2248 <strong style="color:#66ddff">${'{reading}'}</strong> from you are most probable.
           <br><br>Notice the orange <strong style="color:#ff8844">MLE \u2717</strong> marker. That's the
           maximum likelihood estimate using <em>only</em> this reading, no history.`,
    math: 'L(cell) = exp(&minus;|d(cell) &minus; z|\u00b2 / 2\u03c3\u00b2)',
    highlight: null,
    highlightCanvas: 'game-canvas',
    action: 'next',
  },
  {
    title: 'Step 4: Bayes\' Theorem!',
    text: `The <strong style="color:#44aaff">posterior</strong> = prior \u00d7 likelihood, normalized.
           This is Bayes inference! It combines your <em>prior belief</em>
           with <em>new evidence</em> to get an updated belief.
           <br><br>Watch the Belief Map update as it's sharper than either the prior or likelihood alone.`,
    math: 'P(cell | z) \u221d P(cell) \u00d7 L(z | cell)',
    highlight: 'belief-panel',
    highlightCanvas: null,
    action: 'next',
  },
  {
    title: 'Step 5: Prediction',
    text: `Monsters move randomly each turn. To account for this, we <strong>convolve</strong>
           the belief with a Gaussian kernel — it "blurs" slightly, spreading probability mass.
           <br><br>Without this step, your belief would become overconfident and brittle.`,
    math: 'P\u2032(cell) = \u2211 P(cell\u2032) \u00d7 K(cell &minus; cell\u2032)',
    highlight: null,
    highlightCanvas: null,
    action: 'next',
  },
  {
    title: 'Step 6: Your Instruments',
    text: `Your side panels are your instruments:
           <br>\u2022 <strong style="color:#ff66aa">Entropy</strong> - total uncertainty in bits. Watch it drop as you learn!
           <br>\u2022 <strong style="color:#66aaff">Beta Distribution</strong> - tracks sensor reliability over time
           <br>\u2022 <strong style="color:#44dd88">EV Arrows</strong> - expected danger per direction. Follow the green!
           <br>\u2022 <strong style="color:#88aadd">Info Gain</strong> - should you scan or move?
           <br>\u2022 <strong style="color:#88aadd">Music</strong> - Markov chain melody, tenser when you're uncertain`,
    math: null,
    highlight: null,
    highlightCanvas: null,
    action: 'next',
  },
  {
    title: 'Step 7: MLE vs Bayes',
    text: `The orange <strong style="color:#ff8844">\u2717 MLE</strong> marker shows what you'd estimate from
           <em>just the latest reading</em> - no memory, no prior. It jumps around wildly.
           <br><br>The <strong style="color:#ff5555">heatmap</strong> (Bayesian posterior) is smoother and
           more accurate because it integrates <em>all</em> past observations.
           <br><br>This is why Bayes wins.`,
    math: null,
    highlight: null,
    highlightCanvas: 'game-canvas',
    action: 'next',
  },
  {
    title: 'The Challenge',
    text: `Navigate to the <strong style="color:#ffcc00">EXIT</strong> without stepping on monsters.
           Use the heatmap and EV arrows to make smart decisions.
           <br><br><kbd>\u2190\u2191\u2193\u2192</kbd> Move &nbsp; <kbd>Space</kbd> Scan &nbsp; <kbd>R</kbd> Restart
           <br><br>Complete levels to unlock harder challenges. Good luck!`,
    math: null,
    highlight: null,
    highlightCanvas: null,
    action: 'start',
  },
];

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.step = 0;
    this.active = false;
    this.box = document.getElementById('tutorial-box');
    this.waitingForAction = null;
  }

  start() {
    this.active = true;
    this.step = 0;
    this.game.phase = 'TUTORIAL';
    this.game.tutorialActive = true;
    this.show();
  }

  show() {
    if (this.step >= STEPS.length) { this.end(); return; }

    const s = STEPS[this.step];
    let text = s.text;

    if (this.game.lastReading !== null) {
      text = text.replace('{reading}', this.game.lastReading.toFixed(1));
    }

    // Step indicator
    const progress = STEPS.map((_, i) =>
      `<span style="display:inline-block; width:8px; height:8px; border-radius:50%;
       background:${i === this.step ? '#66ddff' : i < this.step ? '#335577' : '#1a2a3a'};
       margin:0 2px"></span>`
    ).join('');

    let html = `<h3>${s.title}</h3><p>${text}</p>`;
    if (s.math) html += `<p class="math">${s.math}</p>`;
    html += `<div style="margin:8px 0 4px">${progress}</div>`;

    if (s.action === 'next' || s.action === 'start') {
      const label = s.action === 'start' ? 'Begin!' : 'Next \u2192';
      html += `<button class="tut-next" id="tut-next-btn">${label}</button>`;
      this.waitingForAction = null;
    } else if (s.action === 'scan') {
      html += `<div style="color:#66ddff; font-size:11px; animation: panelPulse 0.8s ease-in-out infinite alternate">
                 \u2191 Press Space to scan \u2191</div>`;
      this.waitingForAction = 'scan';
    }

    this.box.innerHTML = html;
    this.box.classList.remove('hidden');

    // Highlights
    this._clearHighlights();
    if (s.highlight) {
      const el = document.getElementById(s.highlight);
      if (el) el.classList.add('panel-highlight');
    }
    if (s.highlightCanvas) {
      const el = document.getElementById(s.highlightCanvas);
      if (el) el.style.boxShadow = '0 0 20px #66ddff44';
    }

    const btn = document.getElementById('tut-next-btn');
    if (btn) btn.addEventListener('click', () => this.advance());
  }

  advance() {
    this.step++;
    this.step >= STEPS.length ? this.end() : this.show();
  }

  onAction(action) {
    if (!this.active) return false;
    if (this.waitingForAction === action) {
      this.waitingForAction = null;
      setTimeout(() => this.advance(), 600);
      return true;
    }
    if (this.waitingForAction) return false;
    return false;
  }

  end() {
    this.active = false;
    this.game.phase = 'PLAYING';
    this.game.tutorialActive = false;
    this.box.classList.add('hidden');
    this._clearHighlights();
  }

  _clearHighlights() {
    document.querySelectorAll('.panel-highlight').forEach(el => el.classList.remove('panel-highlight'));
    // Remove canvas highlights
    const gc = document.getElementById('game-canvas');
    if (gc) gc.style.boxShadow = '';
  }
}
