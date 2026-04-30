# Age-Rank

**[→ Live demo](https://d-j-king.github.io/age-rank/)**

<video src="demo.mp4" width="100%" controls autoplay loop muted></video>

An interactive simulation of workplace rank dynamics, grounded in economic theory.

**Why is age-based ranking such a persistent equilibrium in the workplace?** Within any age group, people vary far more in skill and judgment than the average gap between age cohorts. Given those overlapping distributions, you'd expect workplace rank to track competence, with age as just one weak predictor among many. It doesn't. This simulation explores the forces that sustain age-based ordering and the conditions under which competence-based ordering can be sustained.

## What you're looking at

Each dot is an employee. Their horizontal position (age) is fixed. Their vertical position (rank) evolves every frame under three competing forces:

| Force | Slider | Meaning |
|---|---|---|
| **α · competence** | α | Pulls rank toward competence level |
| **β · age** | β | Spring pulling rank back to what age predicts |
| **γ · holdup** | γ | Pushes juniors down when they've displaced seniors |

The key ratio is **α/β**. Below ~0.5 → age-based ordering prevails. Above ~2 → competence-based ordering takes hold. Most real organizations sit around 0.1–0.3.

## The 5 scenarios

Each scenario pre-loads the simulation and fires a mutiny after 1 second.

| # | Scenario | What to watch |
|---|---|---|
| 1 | **[Age-based ordering](https://d-j-king.github.io/age-rank/sim.html?alpha=0.3&beta=1.5&gamma=0.5&sigma=0.06&speed=0.7&label=Age-based+ordering&mutiny=1)** | Blue τ(rank, age) crashes on mutiny, then fully recovers |
| 2 | **[Competence-based ordering](https://d-j-king.github.io/age-rank/sim.html?alpha=1.8&beta=0.3&gamma=0.05&sigma=0.06&speed=0.7&label=Competence-based+ordering)** | Dots self-sort by color; higher-competence dots rise regardless of age |
| 3 | **[Pure ladder-pulling](https://d-j-king.github.io/age-rank/sim.html?alpha=0.2&beta=0.2&gamma=2.0&sigma=0.04&speed=0.5&label=Pure+ladder-pulling&mutiny=1)** | Slower, lumpier recovery, driven by seniors actively resisting rather than by formal norms |
| 4 | **[Competing forces](https://d-j-king.github.io/age-rank/sim.html?alpha=1.0&beta=1.0&gamma=0.2&sigma=0.06&speed=0.7&label=Competing+forces&mutiny=1)** | Age-based ordering still prevails; the structural weight of age outweighs equal α, but recovery is slower and noisier with more variance around the diagonal |
| 5 | **[Adaptive knowledge dynamics](https://d-j-king.github.io/age-rank/sim.html?alpha=0.3&beta=0.8&gamma=1.5&sigma=0.04&speed=0.6&scene=2&label=Adaptive+knowledge+dynamics&mutiny=1)** | Gold rings show seniors hoarding knowledge in real time; rings bloom on threat, fade on calm |

## Running locally

Double-click `index.html`. No install, no server, no build step.

## Theory

See [`explainer.html`](https://d-j-king.github.io/age-rank/explainer.html) for an interactive theory walkthrough, or [`MODEL.md`](MODEL.md) for the full mathematical model with references.

Built on: Lazear (1979) · Lazear & Rosen (1981) · Lindbeck & Snower (1988) · Akerlof & Yellen (1990) · Pluchino et al. (2010) · Kuran (1989)
