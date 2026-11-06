/** mulberry32: a 32-bit seeded generator, uniform in [0, 1); the same seed gives the same sequence on every machine. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A Fisher-Yates shuffle of a copy of `items` drawn from `seed`. */
export function shuffle(items, seed) {
  const out = [...items];
  const random = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Every task × condition × config × rep, in the one order `seed` draws, so the configs' runs
 * interleave. One config draws the same order as a plan that names none.
 */
export function planRuns(tasks, conditions, reps, seed, configs = [undefined]) {
  const plan = [];
  for (const task of tasks)
    for (const condition of conditions)
      for (const config of configs)
        for (let rep = 0; rep < reps; rep++)
          plan.push({ task, condition, config, rep });
  return shuffle(plan, seed);
}

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}
