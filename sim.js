// ============================================================
// Seniority Dynamics — sim.js
// URL params: alpha, beta, gamma, sigma, speed, n, scene, mutiny, label
// Euler-Maruyama integration of the rank SDE:
//   drᵢ = [α(cᵢ−c̄) − β(rᵢ−sᵢ) − γHᵢ] dt + σ dWᵢ
// ============================================================

let agents = [];
let currentScene = 1;
let paused = false;
let history = [];
let mutinyMarkers = [];
let mutinyFlash = 0;
let mutinyFlashKind = 'random';  // 'random' → red, 'merit' → amber
let pageLabel = '';
const HISTORY_LEN = 500;

// Scene 3 cohort state — updated each step, read by renderer
let cohortStats = {
  means:  [0, 0, 0, 0],
  maxes:  [0, 0, 0, 0],
  active: [false, false, false, false],
};

// Layout (set in setup / updateLayout)
let scatterX, scatterY, scatterW, scatterH;
let tsX, tsY, tsW, tsH;

// ============================================================
// p5.js lifecycle
// ============================================================

function setup() {
  const container = document.getElementById('canvas-container');
  const cnv = createCanvas(container.offsetWidth, windowHeight);
  cnv.parent('canvas-container');
  updateLayout();
  applyUrlParams();
  initAgents();
  frameRate(60);
}

function applyUrlParams() {
  const p = new URLSearchParams(window.location.search);
  const set = (sliderId, labelId, val, fmt) => {
    const el = document.getElementById(sliderId);
    if (el && val !== null) {
      el.value = val;
      const lbl = document.getElementById(labelId);
      if (lbl) lbl.textContent = fmt(parseFloat(val));
    }
  };
  if (p.has('alpha')) set('alpha-slider', 'val-alpha', p.get('alpha'), v => v.toFixed(2));
  if (p.has('beta'))  set('beta-slider',  'val-beta',  p.get('beta'),  v => v.toFixed(2));
  if (p.has('gamma')) set('gamma-slider', 'val-gamma', p.get('gamma'), v => v.toFixed(2));
  if (p.has('sigma')) set('sigma-slider', 'val-sigma', p.get('sigma'), v => v.toFixed(2));
  if (p.has('speed')) set('speed-slider', 'val-speed', p.get('speed'), v => v.toFixed(2) + '×');
  if (p.has('n'))     set('n-slider',     'val-n',     p.get('n'),     v => String(Math.round(v)));
  if (p.has('lambda')) set('lambda-slider', 'val-lambda', p.get('lambda'), v => v.toFixed(2));
  if (p.has('eta'))    set('eta-slider',    'val-eta',    p.get('eta'),    v => v.toFixed(2));
  if (p.has('scene')) setScene(parseInt(p.get('scene')));
  if (p.has('label')) pageLabel = p.get('label');
  if (p.has('mutiny')) setTimeout(() => reshuffleMutiny(), 1200);
}

function draw() {
  background(13, 17, 23);

  if (!paused) {
    stepAgents();

    const rP = rankPctiles();
    const tP = tauPctiles();
    const cP = compPctiles();
    const tauRT = kendallTau(tP, rP);
    const tauRC = kendallTau(cP, rP);

    history.push({ tauRT, tauRC });
    if (history.length > HISTORY_LEN) history.shift();

    mutinyMarkers = mutinyMarkers.map(m => m - 1).filter(m => m > -HISTORY_LEN);

    document.getElementById('stat-rt').textContent = tauRT.toFixed(3);
    document.getElementById('stat-rc').textContent = tauRC.toFixed(3);
    if (currentScene === 3) updateCohortBarsDOM();
  }

  drawScatter();
  drawTimeSeries();
}

function windowResized() {
  const container = document.getElementById('canvas-container');
  resizeCanvas(container.offsetWidth, windowHeight);
  updateLayout();
}

function updateLayout() {
  const pad = 44;
  scatterX = pad;
  scatterY = 36;
  scatterW = width - pad * 2;
  scatterH = height * 0.68;

  tsX = pad;
  tsY = scatterY + scatterH + 34;
  tsW = width - pad * 2;
  tsH = height - tsY - pad + 8;
}

// ============================================================
// Color helpers — diverging competence scale
// ============================================================

// Takes competence percentile in [0,1]; returns [r,g,b] on a
// blue → gray → red diverging ramp centered on 0.5 (mean rank).
function competenceColor(p) {
  const t = constrain(p * 2 - 1, -1, 1);   // −1 blue, 0 gray, +1 red
  const blue = [59, 130, 246];
  const mid  = [156, 163, 175];
  const red  = [239, 68, 68];
  const lerp3 = (a, b, k) => [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
  return t < 0 ? lerp3(mid, blue, -t) : lerp3(mid, red, t);
}

function drawCompetenceLegend(x, y, w, h) {
  // Gradient bar
  noStroke();
  const steps = 32;
  for (let k = 0; k < steps; k++) {
    const p = k / (steps - 1);
    const [r, g, b] = competenceColor(p);
    fill(r, g, b, 230);
    rect(x + (k / steps) * w, y, w / steps + 0.5, h);
  }
  // Frame
  noFill();
  stroke(60, 65, 72);
  strokeWeight(1);
  rect(x, y, w, h);
  // Caption above, endpoint labels below
  noStroke();
  textSize(9);
  fill(139, 148, 158);
  textAlign(RIGHT, BOTTOM);
  text('competence', x + w, y - 1);
  textSize(8.5);
  fill(99, 119, 139);
  textAlign(LEFT, TOP);
  text('low',  x,        y + h + 2);
  textAlign(CENTER, TOP);
  text('mean', x + w / 2, y + h + 2);
  textAlign(RIGHT, TOP);
  text('high', x + w,     y + h + 2);
}

// Push cohort state to the sidebar DOM bars (scene 3 only).
function updateCohortBarsDOM() {
  const COHORT_COLS = ['rgb(0,200,255)','rgb(80,220,80)','rgb(255,175,0)','rgb(180,80,255)'];
  const rows = document.querySelectorAll('#cohort-bars .cohort-row');
  rows.forEach((row, g) => {
    const active = cohortStats.active[g];
    const meanPct = Math.max(0, Math.min(1, (cohortStats.means[g] + 1) / 2));
    const maxPct  = Math.max(0, Math.min(1, (cohortStats.maxes[g] + 1) / 2));
    const fill = row.querySelector('.cohort-fill');
    const tick = row.querySelector('.cohort-tick');
    const label = row.querySelector('.cohort-label');
    fill.style.width = (meanPct * 100) + '%';
    fill.style.backgroundColor = COHORT_COLS[g];
    fill.style.opacity = active ? '0.95' : '0.4';
    tick.style.left = 'calc(' + (maxPct * 100) + '% - 1px)';
    tick.style.opacity = active ? '0.9' : '0.35';
    label.style.color = active ? COHORT_COLS[g] : '#6b7380';
  });
}

// ============================================================
// Agents
// ============================================================

function initAgents(opts = {}) {
  const startRandom = !!opts.startRandom;
  const N = parseInt(document.getElementById('n-slider').value);
  agents = [];
  for (let i = 0; i < N; i++) {
    agents.push({
      tau: random(0.05, 1.0),
      c: constrain(randomGaussian(0.5, 0.18), 0.04, 0.96),
      r: 0,
      hoard: 0.2,
    });
  }
  // Assign cohort by age quartile (independent of r init)
  const byTau = [...agents].sort((a, b) => a.tau - b.tau);
  byTau.forEach((a, i) => {
    a.cohort = Math.min(3, Math.floor(i / agents.length * 4));
  });
  if (startRandom) {
    // Scramble r uniformly in [−1, 1]; system must self-organize
    agents.forEach(a => { a.r = random(-1, 1); });
  } else {
    // Start r near the seniority-ordered equilibrium
    byTau.forEach((a, i) => {
      a.r = (i / (agents.length - 1)) * 2 - 1 + randomGaussian(0, 0.07);
    });
  }
  history = [];
  mutinyMarkers = [];
}

// ============================================================
// Physics step (Euler-Maruyama)
// ============================================================

function stepAgents() {
  const N = agents.length;
  const speed = getParam('speed-slider');
  const dt = (1 / 60) * speed;
  const alpha  = getParam('alpha-slider');
  const beta   = getParam('beta-slider');
  const gamma  = getParam('gamma-slider');
  const sigma  = getParam('sigma-slider');
  const eps    = 0.05;   // replicator learning rate
  const decay  = 0.025;  // hoard decay rate

  // Seniority targets: map age rank → [−1, 1]
  const byTau = [...agents].sort((a, b) => a.tau - b.tau);
  const sMap  = new Map(byTau.map((a, i) => [a, N > 1 ? (i / (N - 1)) * 2 - 1 : 0]));
  const medianTau = byTau[floor(N / 2)].tau;
  const cMean = agents.reduce((s, a) => s + a.c, 0) / N;

  // Scene 3: cohort solidarity + dynamic leadership beta
  let betaActive = beta;
  let cohortMaxes = null;
  let lambdaS3 = 0;
  if (currentScene === 3) {
    lambdaS3 = getParam('lambda-slider');
    const eta = getParam('eta-slider');

    // Cohort aggregates: mean, max, and count-above-median (for "coalition active")
    const sums   = new Float32Array(4);
    const counts = new Int32Array(4);
    const maxes  = [-Infinity, -Infinity, -Infinity, -Infinity];
    const rSorted = agents.map(a => a.r).sort((x, y) => x - y);
    const medianR = rSorted[floor(N / 2)];
    const aboveMed = new Int32Array(4);
    for (let i = 0; i < N; i++) {
      const g = agents[i].cohort;
      sums[g] += agents[i].r;
      counts[g]++;
      if (agents[i].r > maxes[g]) maxes[g] = agents[i].r;
      if (agents[i].r > medianR) aboveMed[g]++;
    }
    cohortMaxes = maxes;
    cohortStats.means  = Array.from(sums, (s, g) => counts[g] > 0 ? s / counts[g] : 0);
    cohortStats.maxes  = maxes.map(m => m === -Infinity ? 0 : m);
    cohortStats.active = Array.from(aboveMed, n => n >= 2);

    // Leader = agent with highest current rank; their age percentile modulates beta
    let leaderIdx = 0;
    for (let i = 1; i < N; i++) {
      if (agents[i].r > agents[leaderIdx].r) leaderIdx = i;
    }
    const leaderTauPctile = (sMap.get(agents[leaderIdx]) + 1) / 2;
    // eta=0 → no modulation; eta=1 → oldest leader gives 1.5×beta, youngest 0.5×beta
    betaActive = Math.max(0.05, beta * (1 + (leaderTauPctile - 0.5) * eta));

    document.getElementById('stat-leader').textContent = leaderTauPctile.toFixed(2);
    document.getElementById('stat-betaeff').textContent = betaActive.toFixed(3);
  }

  const dr = new Float32Array(N);
  const dh = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    const a = agents[i];
    const si = sMap.get(a);
    const gammaEff = currentScene === 2 ? gamma * a.hoard : gamma;

    // Holdup: sum of (seniority gap) × (rank gap) for each senior j that i outranks
    let holdup = 0;
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const senGap  = agents[j].tau - a.tau;  // positive if j is senior to i
      const rankGap = a.r - agents[j].r;      // positive if i ranks above j
      if (senGap > 0 && rankGap > 0) {
        holdup += senGap * rankGap;
      }
    }
    holdup /= max(N - 1, 1);

    // Asymmetric coalition lift: high-ranked peers pull allies UP (never down).
    // max(0, ·) means a cohort's top dog drags laggards up in their wake,
    // but no symmetric "pull to mean" dragging high-rankers down.
    const cohortPull = (currentScene === 3 && cohortMaxes)
      ? lambdaS3 * Math.max(0, cohortMaxes[a.cohort] - a.r) : 0;

    dr[i] = (
      alpha      * (a.c - cMean)
      - betaActive * (a.r - si)
      - gammaEff   * holdup
      + cohortPull
    ) * dt + sigma * sqrt(dt) * randomGaussian();

    // Replicator dynamics (scene 2 only)
    if (currentScene === 2) {
      if (a.tau >= medianTau) {
        // Senior: count juniors currently outranking me
        let v = 0;
        for (let j = 0; j < N; j++) {
          if (agents[j].tau < a.tau && agents[j].r > a.r) v++;
        }
        dh[i] = (eps * v - decay * a.hoard) * dt;
      } else {
        dh[i] = -decay * 1.5 * a.hoard * dt;
      }
    }
  }

  for (let i = 0; i < N; i++) {
    agents[i].r += dr[i];
    if (currentScene === 2) {
      agents[i].hoard = constrain(agents[i].hoard + dh[i], 0, 1);
    }
  }

}

// ============================================================
// Statistics
// ============================================================

function pctileMap(key) {
  const N = agents.length;
  const sorted = [...agents].sort((a, b) => a[key] - b[key]);
  return new Map(sorted.map((a, i) => [a, N > 1 ? i / (N - 1) : 0.5]));
}
const rankPctiles = () => { const m = pctileMap('r');   return agents.map(a => m.get(a)); };
const tauPctiles  = () => { const m = pctileMap('tau'); return agents.map(a => m.get(a)); };
const compPctiles = () => { const m = pctileMap('c');   return agents.map(a => m.get(a)); };

function kendallTau(xs, ys) {
  const n = xs.length;
  let con = 0, dis = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = (xs[j] - xs[i]) * (ys[j] - ys[i]);
      if (d > 0) con++;
      else if (d < 0) dis++;
    }
  }
  const denom = n * (n - 1) / 2;
  return denom > 0 ? (con - dis) / denom : 0;
}

// ============================================================
// Rendering — scatter plot
// ============================================================

function drawScatter() {
  const sx = scatterX, sy = scatterY, sw = scatterW, sh = scatterH;

  // Panel
  fill(15, 20, 28);
  stroke(33, 38, 45);
  strokeWeight(1);
  rect(sx, sy, sw, sh, 6);

  // Subtle grid
  stroke(255, 255, 255, 10);
  strokeWeight(1);
  for (let t = 0.25; t < 1; t += 0.25) {
    line(sx + t * sw, sy, sx + t * sw, sy + sh);
    line(sx, sy + t * sh, sx + sw, sy + t * sh);
  }

  // Perfect-seniority diagonal (dashed)
  stroke(255, 255, 255, 40);
  strokeWeight(1.5);
  drawingContext.setLineDash([7, 7]);
  line(sx, sy + sh, sx + sw, sy);  // (0,0)→(1,1) with y flipped
  drawingContext.setLineDash([]);

  // Title
  noStroke();
  textAlign(LEFT, TOP);
  textSize(11);
  fill(139, 148, 158);
  textStyle(BOLD);
  const sceneTag = currentScene === 1 ? 'Scene 1: Kinematic SDE'
                 : currentScene === 2 ? 'Scene 2: Replicator'
                 : 'Scene 3: Coalitions';
  const titleStr = pageLabel ? `${pageLabel}` : sceneTag;
  text(titleStr, sx + 10, sy + 9);
  textStyle(NORMAL);
  if (pageLabel) {
    fill(72, 79, 88);
    textSize(9.5);
    text(sceneTag, sx + 10, sy + 22);
  }


  // Axis labels
  textAlign(CENTER, CENTER);
  textSize(10);
  fill(99, 119, 139);
  text('← young · age · old →', sx + sw / 2, sy + sh + 16);
  push();
  translate(sx - 26, sy + sh / 2);
  rotate(-HALF_PI);
  text('rank ↑', 0, 0);
  pop();

  // Particles
  const rP = rankPctiles();
  const tP = tauPctiles();
  const cP = compPctiles();

  // Cohort rings (scene 3) — bright when that cohort has an active coalition
  // (≥2 members above median rank), faint otherwise.
  if (currentScene === 3) {
    const COHORT_COLS = [[0,200,255],[80,220,80],[255,175,0],[180,80,255]];
    noFill();
    for (let i = 0; i < agents.length; i++) {
      const col = COHORT_COLS[agents[i].cohort];
      const active = cohortStats.active[agents[i].cohort];
      stroke(col[0], col[1], col[2], active ? 200 : 45);
      strokeWeight(active ? 2.3 : 1.0);
      const px = sx + tP[i] * sw;
      const py = sy + (1 - rP[i]) * sh;
      ellipse(px, py, 22, 22);
    }
  }

  // Hoard rings (scene 2) — draw first so dots appear on top
  if (currentScene === 2) {
    noFill();
    strokeWeight(2.2);
    for (let i = 0; i < agents.length; i++) {
      if (agents[i].hoard <= 0.04) continue;
      const px = sx + tP[i] * sw;
      const py = sy + (1 - rP[i]) * sh;
      stroke(255, 195, 40, agents[i].hoard * 190);
      ellipse(px, py, 16 + agents[i].hoard * 18, 16 + agents[i].hoard * 18);
    }
  }

  // Dots — diverging scale around mean competence
  noStroke();
  for (let i = 0; i < agents.length; i++) {
    const px = sx + tP[i] * sw;
    const py = sy + (1 - rP[i]) * sh;
    const [cr, cg, cb] = competenceColor(cP[i]);
    fill(cr, cg, cb, 225);
    ellipse(px, py, 13, 13);
  }

  // Leader highlight (scene 3)
  if (currentScene === 3) {
    // Leader: highest rank percentile
    let leaderI = 0;
    for (let i = 1; i < agents.length; i++) {
      if (rP[i] > rP[leaderI]) leaderI = i;
    }
    const lpx = sx + tP[leaderI] * sw;
    const lpy = sy + (1 - rP[leaderI]) * sh;
    noFill();
    stroke(255, 255, 255, 210);
    strokeWeight(2.5);
    ellipse(lpx, lpy, 25, 25);
    // Star with dark halo for legibility against bright cohort rings
    noStroke();
    textAlign(CENTER, BOTTOM);
    textSize(13);
    fill(15, 20, 28, 230);
    text('★', lpx, lpy - 9);
    textSize(11);
    fill(255, 236, 170, 240);
    text('★', lpx, lpy - 10);

  }

  // Mutiny flash overlay — red for random, amber for merit
  if (mutinyFlash > 0) {
    noStroke();
    const a = map(mutinyFlash, 0, 18, 0, 55);
    if (mutinyFlashKind === 'merit') fill(245, 158, 11, a);
    else                             fill(220, 50, 50, a);
    rect(sx, sy, sw, sh, 6);
    mutinyFlash--;
  }
}

// ============================================================
// Rendering — time series strip
// ============================================================

function drawTimeSeries() {
  const tx = tsX, ty = tsY, tw = tsW, th = tsH;
  const n  = history.length;

  // Panel
  fill(15, 20, 28);
  stroke(33, 38, 45);
  strokeWeight(1);
  rect(tx, ty, tw, th, 6);

  if (n < 2) return;

  const yMid   = ty + th / 2;
  const xScale = tw / HISTORY_LEN;
  const yScale = th / 2 * 0.86;

  // Grid
  stroke(255, 255, 255, 10);
  strokeWeight(1);
  [-0.5, 0.5].forEach(v => line(tx, yMid - v * yScale, tx + tw, yMid - v * yScale));
  stroke(255, 255, 255, 22);
  line(tx, yMid, tx + tw, yMid);  // zero line

  // Mutiny event markers
  stroke(200, 50, 50, 100);
  strokeWeight(1);
  for (const m of mutinyMarkers) {
    const x = tx + tw + m * xScale;
    if (x >= tx && x <= tx + tw) line(x, ty, x, ty + th);
  }

  const xAt = (idx) => tx + (HISTORY_LEN - n + idx) * xScale;
  const yRT = (idx) => yMid - history[idx].tauRT * yScale;
  const yRC = (idx) => yMid - history[idx].tauRC * yScale;

  // Fill under τ(rank, age)
  noStroke();
  fill(79, 195, 247, 22);
  beginShape();
  vertex(xAt(0), yMid);
  for (let i = 0; i < n; i++) vertex(xAt(i), yRT(i));
  vertex(xAt(n - 1), yMid);
  endShape(CLOSE);

  // τ(rank, age) line — blue
  stroke(79, 195, 247);
  strokeWeight(2);
  noFill();
  beginShape();
  for (let i = 0; i < n; i++) vertex(xAt(i), yRT(i));
  endShape();

  // τ(rank, competence) line — orange
  stroke(255, 112, 67);
  strokeWeight(2);
  noFill();
  beginShape();
  for (let i = 0; i < n; i++) vertex(xAt(i), yRC(i));
  endShape();

  // Legend
  noStroke();
  textAlign(LEFT, TOP);
  textSize(9.5);
  fill(79, 195, 247);
  text('— τ(rank, age)', tx + 8, ty + 6);
  fill(255, 112, 67);
  text('— τ(rank, competence)', tx + 8, ty + 19);

  // Axis tick labels
  fill(72, 79, 88);
  textAlign(RIGHT, CENTER);
  textSize(9);
  text('+1', tx + tw - 3, ty + 11);
  text('0',  tx + tw - 3, yMid);
  text('−1', tx + tw - 3, ty + th - 11);

  // Time axis hint + τ primer
  textAlign(LEFT, TOP);
  textSize(9);
  fill(72, 79, 88);
  text('past', tx + 4, ty + th - 12);
  textAlign(RIGHT, TOP);
  text('now', tx + tw - 22, ty + th - 12);
  textAlign(CENTER, TOP);
  fill(99, 119, 139);
  text('τ = 1 perfect order · 0 random · −1 inverted', tx + tw / 2, ty + th - 12);

  // Current-value labels at right edge of lines
  if (n > 0) {
    const lastRT = history[n - 1].tauRT;
    const lastRC = history[n - 1].tauRC;
    const ryRT = constrain(yMid - lastRT * yScale, ty + 6, ty + th - 6);
    const ryRC = constrain(yMid - lastRC * yScale, ty + 6, ty + th - 6);
    textAlign(LEFT, CENTER);
    textSize(9);
    fill(79, 195, 247);
    text(lastRT.toFixed(2), tx + tw + 4, ryRT);
    fill(255, 112, 67);
    text(lastRC.toFixed(2), tx + tw + 4, ryRC);
  }
}

// ============================================================
// Controls
// ============================================================

function getParam(id) {
  return parseFloat(document.getElementById(id).value);
}

function setScene(n) {
  currentScene = n;
  document.getElementById('btn-scene1').classList.toggle('active', n === 1);
  document.getElementById('btn-scene2').classList.toggle('active', n === 2);
  document.getElementById('btn-scene3').classList.toggle('active', n === 3);
  if (n === 2) {
    agents.forEach(a => { a.hoard = 0.2; });
  }
  const s3 = n === 3;
  document.getElementById('scene3-sliders').style.display = s3 ? 'flex' : 'none';
  document.getElementById('stat-leader-row').style.display = s3 ? 'flex' : 'none';
  document.getElementById('stat-betaeff-row').style.display = s3 ? 'flex' : 'none';
  document.getElementById('coalitions-panel').style.display = s3 ? 'block' : 'none';
}

function togglePause() {
  paused = !paused;
  const btn = document.getElementById('btn-pause');
  btn.innerHTML = paused
    ? '<span class="btn-icon">▶</span> Play'
    : '<span class="btn-icon">⏸</span> Pause';
}

function reshuffleMutiny() {
  const rs = agents.map(a => a.r);
  for (let i = rs.length - 1; i > 0; i--) {
    const j = floor(random(i + 1));
    [rs[i], rs[j]] = [rs[j], rs[i]];
  }
  agents.forEach((a, i) => { a.r = rs[i]; });
  mutinyFlash = 18;
  mutinyFlashKind = 'random';
  mutinyMarkers.push(0);
}

function meritocraticMutiny() {
  // Assign ranks sorted by competence (most competent → highest rank)
  const byComp = [...agents].sort((a, b) => a.c - b.c);
  const rs = [...agents].sort((a, b) => a.r - b.r).map(a => a.r);
  byComp.forEach((a, i) => { a.r = rs[i]; });
  mutinyFlash = 18;
  mutinyFlashKind = 'merit';
  mutinyMarkers.push(0);
}

function resetSim(opts = {}) {
  initAgents(opts);
  document.getElementById('stat-rt').textContent = '—';
  document.getElementById('stat-rc').textContent = '—';
}

function resetSimRandom() {
  resetSim({ startRandom: true });
}

function onNChange(val) {
  document.getElementById('val-n').textContent = val;
  resetSim();
}

function updateLabel(name, val) {
  document.getElementById('val-' + name).textContent = parseFloat(val).toFixed(2);
}

function updateSpeedLabel(val) {
  document.getElementById('val-speed').textContent = parseFloat(val).toFixed(2) + '×';
}
