/**
 * Deterministic seeded RNG (mulberry32) for the film engine.
 *
 * Every generated film derives entirely from its seed, so a seed is a
 * shareable, replayable identity for a film: same seed, same title, same
 * poster, same beat timeline, forever.
 */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick one element. Throws on empty input so content-bank gaps fail loudly in tests. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('pick() called with an empty list');
  }
  return items[Math.floor(rng() * items.length)];
}

/** Integer in [min, max] inclusive. */
export function pickInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Number in [min, max). */
export function pickRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** True with probability p. */
export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}
