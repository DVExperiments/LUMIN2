/**
 * Long-term adaptation: slow morphology variables and permanent marks.
 *
 * Each processed hour of weather nudges morphology toward targets computed from
 * the long and deep exposure averages. Morphology itself lags those targets
 * (τ ≈ 36 observed hours, scaled by the genome's plasticity), so acquired
 * structure persists after the weather that caused it has passed and then
 * relaxes gradually. Extreme events leave marks that fade over months.
 */
import { clamp, emaWeight, smoothstep } from '../core/math';
import type { Exposure, WeatherEvent } from '../memory/environment';
import type { Features } from '../memory/features';
import type { Genome } from './genome';

export const MORPH_TAU_HOURS = 36;
/** Prenatal (ancestral) hours shape the newborn more gently than lived ones. */
export const PRENATAL_WEIGHT = 0.6;
const MARK_FADE_HOURS = 24 * 120;

export interface Morphology {
  /** Streamlined stretch acquired from sustained wind. */
  elongation: number;
  /** Acquired axis of the stretch (direction the wind pushed), not normalised. */
  axisX: number;
  axisY: number;
  /** Faceted, crystalline structure from sustained cold. */
  crystal: number;
  /** Overall body size and openness from warmth and light. */
  expanse: number;
  /** Long, flowing filaments from humidity, warmth and wind. */
  filament: number;
  /** Number of fine cilia and branching from rain and cloud. */
  density: number;
  /** Self-luminance: organisms raised in dim, cloudy climates glow brighter. */
  luminance: number;
  /** Glow diffusion and membrane softness from humidity. */
  softness: number;
  /** Colour drift: −1 cold-shifted, +1 warm-shifted. */
  hueDrift: number;
  /** Toughened, more stable behaviour from volatile weather. */
  resilience: number;
}

export interface Marks {
  /** Growth rings: one per storm survived (fractional while fading). */
  rings: number;
  /** Frost scarring adds permanent facets. */
  facets: number;
  /** Heat leaves a warm, ember-like core. */
  ember: number;
  /** Deluges and long rains leave luminous vacuoles. */
  vacuoles: number;
  /** Long stillness leaves a calm outer halo. */
  halo: number;
}

export function neutralMorphology(): Morphology {
  return {
    elongation: 0.1,
    axisX: 0,
    axisY: 0,
    crystal: 0.2,
    expanse: 0.5,
    filament: 0.45,
    density: 0.35,
    luminance: 0.55,
    softness: 0.5,
    hueDrift: 0,
    resilience: 0.3,
  };
}

export function emptyMarks(): Marks {
  return { rings: 0, facets: 0, ember: 0, vacuoles: 0, halo: 0 };
}

/** Pure function: where morphology is heading given what the organism has lived through. */
export function morphologyTargets(ex: Exposure, out: Morphology = neutralMorphology()): Morphology {
  const L: Features = ex.long;
  const D: Features = ex.deep;
  out.elongation = clamp(smoothstep(0.22, 0.72, L.wind) * 0.9 + L.storm * 0.35);
  out.axisX = L.windX;
  out.axisY = L.windY;
  out.crystal = clamp(smoothstep(0.55, 0.12, L.warmth) * 0.75 + L.frost * 0.7 - L.humidity * 0.1);
  out.expanse = clamp(0.2 + 0.45 * smoothstep(0.3, 0.85, L.warmth) + 0.2 * L.light + 0.15 * L.humidity - 0.3 * L.frost);
  out.filament = clamp(0.2 + 0.35 * L.humidity * smoothstep(0.2, 0.7, L.warmth) + 0.3 * L.wind + 0.25 * smoothstep(0, 0.3, L.rain));
  out.density = clamp(0.15 + 0.6 * smoothstep(0, 0.32, L.rain) + 0.25 * L.cloud);
  out.luminance = clamp(0.35 + 0.4 * (1 - L.light) + 0.25 * L.cloud);
  out.softness = clamp(smoothstep(0.45, 0.95, L.humidity) * 0.8 + L.rain * 0.3);
  out.hueDrift = clamp((D.warmth - 0.5) * 2.4 - D.rain * 0.6 - D.frost * 0.5, -1, 1);
  out.resilience = clamp(ex.volatility * 1.6 + D.storm * 0.8 + D.wind * 0.3);
  return out;
}

const targetScratch = neutralMorphology();

/** Advance morphology by one observed hour. Deterministic. */
export function adaptHour(
  morph: Morphology,
  marks: Marks,
  ex: Exposure,
  genome: Genome,
  prenatal: boolean,
): void {
  const t = morphologyTargets(ex, targetScratch);
  const w = emaWeight(1, MORPH_TAU_HOURS) * (prenatal ? PRENATAL_WEIGHT : 1);
  const p = genome.plasticity;
  morph.elongation += (t.elongation - morph.elongation) * w * p.elongation;
  morph.axisX += (t.axisX - morph.axisX) * w * p.elongation;
  morph.axisY += (t.axisY - morph.axisY) * w * p.elongation;
  morph.crystal += (t.crystal - morph.crystal) * w * p.crystal;
  morph.expanse += (t.expanse - morph.expanse) * w * p.expanse;
  morph.filament += (t.filament - morph.filament) * w * p.filament;
  morph.density += (t.density - morph.density) * w * p.density;
  morph.luminance += (t.luminance - morph.luminance) * w * p.luminance;
  morph.softness += (t.softness - morph.softness) * w * p.softness;
  // Colour identity drifts an order of magnitude slower than shape.
  morph.hueDrift += (t.hueDrift - morph.hueDrift) * w * 0.15 * p.hueDrift;
  morph.resilience += (t.resilience - morph.resilience) * w * 0.5;

  const fade = Math.exp(-1 / MARK_FADE_HOURS);
  marks.rings *= Math.pow(fade, 0.35); // rings are the most durable marks
  marks.facets *= fade;
  marks.ember *= fade;
  marks.vacuoles *= fade;
  marks.halo *= fade;
}

/** Permanent (slowly fading) marks left by notable weather events. */
export function applyEvent(marks: Marks, ev: WeatherEvent): void {
  const k = ev.prenatal ? 0.5 : 1;
  switch (ev.kind) {
    case 'storm':
      marks.rings = Math.min(9, marks.rings + k);
      break;
    case 'frost':
      marks.facets = clamp(marks.facets + 0.18 * k);
      break;
    case 'heat':
      marks.ember = clamp(marks.ember + 0.2 * k);
      break;
    case 'deluge':
    case 'long-rain':
      marks.vacuoles = Math.min(12, marks.vacuoles + 1.5 * k);
      break;
    case 'stillness':
      marks.halo = clamp(marks.halo + 0.25 * k);
      break;
  }
}

/** Distance between two morphologies, used to describe change since the last visit. */
export function morphDelta(a: Morphology, b: Morphology): Partial<Record<keyof Morphology, number>> {
  const out: Partial<Record<keyof Morphology, number>> = {};
  for (const k of Object.keys(a) as (keyof Morphology)[]) {
    if (k === 'axisX' || k === 'axisY') continue;
    out[k] = b[k] - a[k];
  }
  return out;
}
