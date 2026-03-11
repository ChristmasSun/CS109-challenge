/* ============================================================
   MATH LIBRARY — CS109 Concepts from First Principles
   ============================================================ */

export const GRID = 16;
export const CELLS = GRID * GRID;
export const CELL_PX = 36;
export const CANVAS_PX = GRID * CELL_PX;

// Box-Muller transform for Gaussian random numbers
export function randn() {
  const u1 = Math.random(), u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Gaussian PDF (unnormalized)
export function gaussianPDF(x, mu, sigma) {
  return Math.exp(-((x - mu) ** 2) / (2 * sigma ** 2));
}

// Shannon entropy in bits
export function shannonEntropy(belief) {
  let h = 0;
  for (let i = 0; i < belief.length; i++) {
    if (belief[i] > 1e-15) h -= belief[i] * Math.log2(belief[i]);
  }
  return h;
}

// Euclidean distance
export function dist(r1, c1, r2, c2) {
  return Math.sqrt((r1 - r2) ** 2 + (c1 - c2) ** 2);
}

// Lanczos log-gamma approximation
export function lnGamma(z) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

// Beta distribution PDF
export function betaPDF(x, a, b) {
  if (x <= 0 || x >= 1) return 0;
  const lnB = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lnB);
}

// Bootstrap confidence interval for the mean
export function bootstrapCI(data, nBoot = 400) {
  if (data.length < 5) return null;
  const means = [];
  for (let b = 0; b < nBoot; b++) {
    let s = 0;
    for (let i = 0; i < data.length; i++) {
      s += data[Math.floor(Math.random() * data.length)];
    }
    means.push(s / data.length);
  }
  means.sort((a, b) => a - b);
  return {
    lo: means[Math.floor(nBoot * 0.025)],
    mean: means.reduce((a, b) => a + b) / nBoot,
    hi: means[Math.floor(nBoot * 0.975)],
    samples: means
  };
}

// 2D convolution on flat GRID×GRID array
export function convolve2D(belief, kernel, kSize) {
  const out = new Float64Array(CELLS);
  const half = Math.floor(kSize / 2);
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      let sum = 0;
      for (let kr = 0; kr < kSize; kr++) {
        for (let kc = 0; kc < kSize; kc++) {
          const sr = r + kr - half, sc = c + kc - half;
          if (sr >= 0 && sr < GRID && sc >= 0 && sc < GRID) {
            sum += belief[sr * GRID + sc] * kernel[kr * kSize + kc];
          }
        }
      }
      out[r * GRID + c] = sum;
    }
  }
  return out;
}

// Build a Gaussian motion kernel
export function makeMotionKernel(sigma) {
  const size = 5, half = 2;
  const k = new Float64Array(size * size);
  let sum = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const d2 = (r - half) ** 2 + (c - half) ** 2;
      k[r * size + c] = Math.exp(-d2 / (2 * sigma ** 2));
      sum += k[r * size + c];
    }
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return { data: k, size };
}

// Normalize a probability array
export function normalize(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  if (s > 0) for (let i = 0; i < arr.length; i++) arr[i] /= s;
  else for (let i = 0; i < arr.length; i++) arr[i] = 1 / arr.length;
}
