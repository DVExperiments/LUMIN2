/** Deterministic pseudo-random generation. Every organism derives its traits from a seed. */

/** Hash an arbitrary string to a 32-bit unsigned integer (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: tiny, fast, good-quality deterministic PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Create a fresh random seed using the platform CSPRNG when available. */
export function freshSeed(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] >>> 0;
  }
  return (Math.random() * 4294967296) >>> 0;
}
