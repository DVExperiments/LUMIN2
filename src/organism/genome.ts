/**
 * Genome: immutable traits derived deterministically from the organism's seed.
 * Two organisms with different seeds differ even under identical weather; the
 * same seed always reproduces the same individual.
 */
import { mulberry32 } from '../core/random';

export interface Genome {
  seed: number;
  name: string;
  /** Base hue in turns (0..1). */
  hue: number;
  /** Width of the colour family across body and filaments. */
  hueSpread: number;
  /** Preferred lobe count for the membrane (3..7). */
  symmetry: number;
  /** Phase offsets for each membrane harmonic, so silhouettes are individual. */
  lobePhases: number[];
  /** Relative lobe strengths. */
  lobeWeights: number[];
  tendrilBase: number;
  ciliaBase: number;
  /** Long filament length multiplier. */
  reach: number;
  /** How readily each morphology trait responds to the environment (0.6..1.4). */
  plasticity: {
    elongation: number;
    crystal: number;
    expanse: number;
    filament: number;
    density: number;
    luminance: number;
    softness: number;
    hueDrift: number;
  };
  /** Innate behavioural tendencies (0..1). */
  curiosity: number;
  skittishness: number;
  /** Seconds per heartbeat at rest. */
  pulsePeriod: number;
  /** +1 or −1: direction of the slow body rotation. */
  chirality: number;
  /** Innate temperature preference on the warmth axis (0..1). */
  warmthPreference: number;
}

const ONSETS = ['v', 'l', 'th', 'm', 's', 'n', 'k', 'r', 'h', 'z', 'sh', 'f', 'd', 'qu'];
const NUCLEI = ['e', 'i', 'a', 'o', 'u', 'y', 'ae', 'ei', 'ou', 'ia'];
const CODAS = ['l', 'th', 'n', 'r', 's', 'x', 'm', 'sk', '', ''];

/** Pronounceable name: strict consonant–vowel syllables, closed by an optional coda. */
export function nameFromSeed(seed: number): string {
  const r = mulberry32(seed ^ 0xa5a5a5a5);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const syllables = 2 + (r() < 0.3 ? 1 : 0);
  let s = '';
  for (let i = 0; i < syllables; i++) {
    let onset = pick(ONSETS);
    if (i === 0 && r() < 0.18) onset = '';
    s += onset + pick(NUCLEI);
  }
  s += pick(CODAS);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function createGenome(seed: number): Genome {
  const r = mulberry32(seed);
  const range = (a: number, b: number) => a + (b - a) * r();
  const symmetry = 3 + Math.floor(r() * 5);
  const lobePhases: number[] = [];
  const lobeWeights: number[] = [];
  for (let k = 0; k < 8; k++) {
    lobePhases.push(r() * Math.PI * 2);
    lobeWeights.push(range(0.3, 1));
  }
  // Hue families chosen to stay luminous: avoid muddy yellow-greens.
  const families = [0.53, 0.58, 0.64, 0.72, 0.8, 0.88, 0.47, 0.98];
  const hue = (families[Math.floor(r() * families.length)] + range(-0.03, 0.03) + 1) % 1;
  return {
    seed,
    name: nameFromSeed(seed),
    hue,
    hueSpread: range(0.06, 0.16),
    symmetry,
    lobePhases,
    lobeWeights,
    tendrilBase: 9 + Math.floor(r() * 6),
    ciliaBase: 46 + Math.floor(r() * 30),
    reach: range(0.85, 1.2),
    plasticity: {
      elongation: range(0.6, 1.4),
      crystal: range(0.6, 1.4),
      expanse: range(0.6, 1.4),
      filament: range(0.6, 1.4),
      density: range(0.6, 1.4),
      luminance: range(0.6, 1.4),
      softness: range(0.6, 1.4),
      hueDrift: range(0.6, 1.4),
    },
    curiosity: range(0.3, 0.8),
    skittishness: range(0.2, 0.75),
    pulsePeriod: range(2.6, 4.2),
    chirality: r() < 0.5 ? -1 : 1,
    warmthPreference: range(0.4, 0.62),
  };
}
