## Overview

This is an interactive, turn based dungeon game as part of the optional CS109 course challenge. As such, every core mechanic is built on a concept from CS109. The player navigates a 16×16 grid dungeon in fog, avoiding hidden monsters while making their way to the exit. The twist is that you can't see the monsters directly. Instead, each turn your sonar sensor gives you a **noisy distance reading** to the nearest monster, and you must use **Bayesian inference** to build and maintain a probabilistic belief about where the monsters are.

Thus, the probability is the gameplay. Players who understand and use the Bayesian heatmap, expected value arrows, and information gain panel will measurably outperform players who move randomly. 

---

## How to Play

put link here once i deploy this to vercel or wtv

### Controls
| Key | Action |
|-----|--------|
| Arrow keys / WASD | Move one cell in a direction |
| Space | **Scan**  - stay in place, get a higher-quality sensor reading |
| R | Restart the game |
| M | Mute/unmute the procedural music |

### Objective
Navigate from the starting position (top-left region) to the **EXIT** (bottom-right region) without losing all 3 lives. You lose a life each time you step on a cell occupied by a monster.

### Core Loop
Each turn, the following happens:
1. You **move** to an adjacent cell (or **scan** to stay put with a better sensor reading)
2. **Monsters move**  - each monster has a 35% chance of stepping to a random adjacent cell
3. **Sonar ping**  - you receive a noisy distance reading to the nearest monster
4. **Bayesian update**  - your belief heatmap updates based on the new reading
5. All side panels refresh with updated CS109 visualizations

---

## What You See on Screen

### Main Game Canvas (Center)

**The Grid**  - A 16×16 dungeon with walls (dark raised tiles) and open floor. Border cells are always walls. Interior walls are scattered randomly but a path from start to exit is always guaranteed.

**Fog of War**  - Cells you haven't visited are obscured. Cells near your current position are visible (radius of ~2.5 cells). Visited cells remain permanently revealed. The fog has a gradient falloff  - cells further from you are progressively darker, rather than a hard cutoff.

**Belief Heatmap Overlay**  - The most important visual. Every open cell is shaded from dark (low probability of monster) to bright orange/red (high probability of monster). This is the **posterior distribution** P(monster at cell | all observations so far). The heatmap updates every single turn.

**Sonar Ring Animation**  - When you move or scan, a cyan ring expands outward from your position. The radius corresponds to the sensor reading. Particles fly outward along the ring.

**Player**  - A bright cyan glowing dot with a white center. Smoothly interpolates between cells rather than teleporting.

**Exit**  - A golden square labeled "EXIT" in the bottom-right region.

**Monsters**  - Red circles with an "!" symbol. Only visible when they are in cells you have visited/revealed. If a monster moves into fog, you can no longer see it  - but your belief heatmap still tracks it.

**Sensor Reading Label**  - A small "d≈X.X" label above your player showing the latest distance reading.

---

### Left Panel

**Status Panel**
- **Lives**  - Red hearts. You start with 3. Lose one each time you step on a monster.
- **Turn**  - How many turns have elapsed.
- **Monsters**  - Shows "?" during gameplay (you don't know how many remain). Revealed on game over.
- **Sensor**  - The latest sonar distance reading.
- **Scan Bar**  - A gradient bar showing the current estimated sensor reliability, derived from the Beta distribution.

**Entropy Panel**  - A line chart showing Shannon entropy of the belief distribution over time. See the Entropy section below for the full concept explanation.

**Sensor Reliability Panel**  - A plot of the Beta distribution PDF tracking how reliable your sensor has been. See the Beta Distribution section below.

**Controls Legend**  - Quick reference for keybindings and a color legend for game elements.

---

### Right Panel

**Belief Map**  - A minimap-sized rendering of the full posterior distribution without fog. This gives you a bird's-eye view of your current beliefs about monster locations. Hot spots (bright cells) are where you think monsters are most likely to be.

**Move Safety (EV)**  - A 3×3 directional grid showing the expected danger for each move direction (up, down, left, right). Green = safer, red = more dangerous. Walls show as dark/disabled. This is computed from the belief distribution  - see Expected Value below.

**Markov Music**  - A heatmap of the current transition matrix used by the procedural music engine. Shows which note transitions are most probable and how the matrix shifts with tension. See Markov Chain Music below.

**Info Gain**  - A bar chart showing the expected information gain (in bits) for each possible action: Move Up, Move Down, Move Left, Move Right, and Scan. Higher bars mean that action would reduce your uncertainty the most. See Information Gain below.

**Post-Game Analysis**  - After winning or losing, this panel shows a histogram of bootstrapped mean sensor errors with a Gaussian overlay and 95% confidence interval markers. See Bootstrap and CLT below.

---

## CS109 concepts

### 1. Bayes' Theorem

**Where:** The entire belief heatmap. Every single turn.

**How it works:** The belief grid is a discrete probability distribution over all cells: P(monster at cell | all observations). Each turn, it is updated by Bayes' theorem:

```
P(cell | z) ∝ P(cell) × L(z | cell)
```

Where:
- P(cell) is the **prior**  - your belief from the previous turn
- L(z | cell) is the **likelihood**  - how probable is the sensor reading z if there were a monster at that cell?
- P(cell | z) is the **posterior**  - your updated belief after incorporating the new evidence

After multiplying, the entire grid is **normalized** so all values sum to 1, making it a valid probability distribution. This is textbook Bayes' theorem applied to a grid of hypotheses.

**What to watch:** On the first turn, the prior is uniform (all cells equally likely). After a sonar ping, you'll see a ring of high probability form  - that's the likelihood dominating. After several turns from different positions, the rings intersect, and the posterior concentrates on the true monster locations.

---

### 2. Gaussian Distribution

**Where:** The sensor noise model. The motion prediction kernel.

**How it works:** The sonar sensor gives you a distance reading:

```
z = d_true + ε,  ε ~ N(0, σ²)
```

The true distance to the nearest monster is corrupted by Gaussian noise with standard deviation σ. This means:
- Most of the time the reading is close to the truth
- Occasionally it's quite far off
- The error distribution is symmetric and bell-shaped

The **likelihood function** used in the Bayesian update is also Gaussian:

```
L(cell) = exp(-|d(player, cell) - z|² / 2σ²)
```

For each cell, we compute its distance from the player, compare that to the sensor reading, and assign higher likelihood to cells whose distance matches the reading. This creates the characteristic "ring" pattern on the heatmap.

The **prediction step** also uses a Gaussian  - a 5×5 Gaussian kernel convolved with the belief grid to account for monster movement uncertainty.

**What to watch:** When sensor noise σ is low, the likelihood ring is sharp and narrow. When σ is high, it's broad and diffuse, making it harder to localize monsters.

---

### 3. Conditional Probability + Markov Chains

**Where:** The procedural music engine and its transition matrix visualization.

**How it works:** The background music is generated by a Markov chain over a 7-note pentatonic scale (C4, D4, E4, G4, A4, C5, D5). Each note's successor is chosen by sampling from a row of a **transition matrix**:

```
P(next note | current note)
```

Each row of the matrix is a conditional probability distribution  - it sums to 1 and defines the probability of transitioning to each possible next note given the current note.

Two matrices are defined:
- **Calm**  - favors stepwise motion (adjacent notes), producing smooth, consonant melodies
- **Tense**  - favors large jumps and repeated notes, producing more dissonant, unsettling music

The game **blends** the two matrices based on the current entropy of the belief distribution. Higher entropy (more uncertainty about monster locations) produces tenser music. As you locate monsters and entropy drops, the music calms down.

The transition matrix is visualized as a heatmap in the Markov Music panel. Brighter cells indicate higher transition probability. The current note's row is highlighted.

**What to watch:** Listen to how the music changes character as you play. Early in the game when uncertainty is high, the music is faster and more jumpy. As your belief concentrates, it becomes slower and more melodic.

---

### 4. Expected Value

**Where:** The Move Safety (EV) panel.

**How it works:** Before each move, the game computes the expected danger of moving in each of the four cardinal directions. For a potential move to cell (r, c):

```
EV(danger) = Σ belief[cell] × weight(cell)
```

Where the sum is over cells in the neighborhood of the target cell, and the weight is 3 for the target cell itself (you'd step directly on it) and 1 for adjacent cells (monster could move into you next turn).

Higher EV means more expected danger. The directional arrows in the EV grid are colored accordingly: green (low danger, safer) to red (high danger, avoid).

**What to watch:** The EV arrows directly recommend which direction to move. Following the green arrows  - choosing the move with lowest expected danger  - is a probabilistically optimal strategy. Players who use the EV panel will survive more often than those who don't.

---

### 5. Shannon Entropy / Information Theory

**Where:** The Entropy panel (line chart). The Info Gain panel (bar chart).

**Entropy  - how it works:** Shannon entropy measures the total uncertainty of a probability distribution:

```
H = -Σ P(cell) × log₂(P(cell))
```

When the belief is uniform (maximum ignorance), entropy is at its maximum: log₂(N) bits, where N is the number of open cells. As observations accumulate and the belief concentrates on true monster locations, entropy decreases. If you were perfectly certain about every monster's location, entropy would drop toward its minimum.

**Information Gain  - how it works:** For each possible action (move in 4 directions or scan), the game estimates the expected entropy of the posterior after taking that action:

```
InfoGain(action) = H(current belief) - E[H(belief after action)]
```

Actions that would reduce uncertainty the most have higher information gain. Scanning (staying put with a better sensor reading) often has higher information gain than moving, especially when uncertainty is high  - but it costs a turn of progress toward the exit.

**What to watch:** The entropy chart typically starts high and trends downward as you gather readings. It can spike back up when monsters move to unexpected locations. The info gain bars reveal the scan-vs-move tradeoff: early in the game, scanning is often the most informative action, but as you localize the monsters, moving toward the exit becomes more valuable.

---

### 6. Beta Distribution

**Where:** The Sensor Reliability panel.

**How it works:** The game maintains a Beta(α, β) distribution that tracks how reliable the sensor has been over time. After each sonar ping:

1. Compute the actual sensor error = |reading - true distance|
2. Compute the probability of this error under a "good sensor" model (small σ Gaussian) vs. a "bad sensor" model (uniform/large)
3. Use the likelihood ratio as a soft weight w ∈ [0, 1]
4. Update: α += w (evidence of reliability), β += (1 - w) (evidence of unreliability)

A slow decay (multiplying α and β by 0.995 each turn) keeps the distribution adaptive  - it doesn't get locked into early conclusions.

The **mean of the Beta distribution** E[p] = α / (α + β) represents the estimated probability that the sensor is reliable. This value modulates the sensor noise: higher reliability → lower effective σ → sharper likelihood → more informative updates.

**What to watch:** The Beta PDF curve in the panel starts broad (Beta(2,2), centered at 0.5). As the game progresses and the sensor proves reliable, the distribution shifts right and narrows, concentrating near 1.0. The scan bar in the Status panel also reflects this  - it fills up as reliability increases.

---

### 7. Central Limit Theorem (Lecture 15)

**Where:** The Post-Game Analysis panel (after winning or losing).

**How it works:** After a game ends, the panel displays a histogram of **bootstrapped sample means** of the sensor errors. The Central Limit Theorem states that:

```
The distribution of sample means approaches a Gaussian as sample size increases,
regardless of the underlying distribution.
```

The sensor errors themselves are not Gaussian  - they are absolute values of Gaussian noise, which follow a half-normal distribution. But the distribution of their **means** (computed via bootstrap resampling) converges to a Gaussian shape. The post-game panel overlays a fitted Gaussian curve (white dashed line) on the histogram to demonstrate this convergence visually.

**What to watch:** The histogram of bootstrap means should look approximately bell-shaped, even though individual sensor errors are not normally distributed. This is the CLT in action.

---

### 8. Bootstrapping

**Where:** The Post-Game Analysis panel (after winning or losing).

**How it works:** After the game ends, we have a collection of sensor error measurements. To estimate a confidence interval for the **true mean sensor error**, we use the bootstrap:

1. From the n observed errors, draw n samples **with replacement** (a bootstrap sample)
2. Compute the mean of this bootstrap sample
3. Repeat 400 times to get a distribution of bootstrap means
4. The 2.5th and 97.5th percentiles of this distribution form the **95% bootstrap confidence interval**

This requires no assumptions about the underlying distribution  - it's a nonparametric method that works purely from the empirical data.

**What to watch:** The red dashed vertical lines on the histogram mark the 95% CI bounds. The white vertical line marks the bootstrap mean. A narrower CI means more precise estimation  - which happens when you've played more turns and accumulated more data points.

---

### 9. Prediction via Convolution

**Where:** The belief update, applied every turn before the observation step.

**How it works:** Monsters move randomly each turn. To account for this, the prediction step **convolves** the belief grid with a 2D Gaussian kernel:

```
P'(cell) = Σ P(cell') × K(cell - cell')
```

Where K is a 5×5 Gaussian kernel centered at the origin. This is equivalent to "blurring" the belief  - probability mass spreads outward from high-probability cells, reflecting the uncertainty about where monsters moved.

After convolution, wall cells are zeroed out and the distribution is renormalized. Without this step, the belief would become overconfident  - it would stay concentrated on where the monster was last estimated, even as the monster moves away.

**What to watch:** If you stay still for several turns, you'll see the belief heatmap gradually "diffuse"  - sharp peaks spread out as the prediction step accounts for monster movement. Each new observation then sharpens the belief again. This predict-update cycle is the heartbeat of Bayesian filtering.

---

### 10. MLE vs Bayesian Inference

**Where:** The orange MLE marker on the game canvas. The MLE vs Bayes error chart in the level completion summary.

**How it works:** Each turn, the game computes two estimates of the nearest monster's position:

- **MLE (Maximum Likelihood Estimate)**  - The cell that maximizes the likelihood of *only the current observation*. It uses no history, no prior  - just argmax L(cell | z). This is shown as an orange ✗ on the canvas.
- **Bayesian posterior**  - The full belief distribution incorporating *all* past observations via Bayes' theorem. The highest-probability cell is the Bayesian point estimate.

The game tracks the error of both estimates over time (distance from estimate to the actual nearest monster). At the end of each level, the summary screen plots cumulative error for both methods and computes a "Bayes advantage" percentage.

**What to watch:** The MLE marker jumps around wildly from turn to turn because it has no memory  - each reading produces a completely different estimate. The Bayesian heatmap is smooth and stable because it integrates all evidence. The post-game chart quantifies this: the Bayesian estimate consistently has lower cumulative error.