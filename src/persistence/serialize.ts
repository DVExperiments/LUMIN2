/**
 * Versioned serialisation of organism state with migration and validation.
 * Imported data is treated as untrusted: every field is type-checked and
 * missing structure is filled from defaults rather than trusted blindly.
 */
import { createOrganism, SCHEMA_VERSION, type OrganismState } from '../organism/state';
import { emptyMarks, neutralMorphology, type Marks, type Morphology } from '../organism/adaptation';
import { createMemory, type EnvironmentMemory } from '../memory/environment';
import { FEATURE_KEYS, neutralFeatures, type Features } from '../memory/features';
import { createInteractionMemory, type InteractionMemory } from '../memory/interaction';
import type { HourRecord } from '../weather/types';

export const EXPORT_FORMAT = 'lumin-organism';

export interface ExportEnvelope {
  format: typeof EXPORT_FORMAT;
  schema: number;
  exportedAt: number;
  organism: OrganismState;
}

export class ImportError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

function features(v: unknown): Features {
  const f = neutralFeatures();
  if (!isObj(v)) return f;
  for (const k of FEATURE_KEYS) f[k] = num(v[k], f[k], -1, 1);
  return f;
}

function morphology(v: unknown): Morphology {
  const m = neutralMorphology();
  if (!isObj(v)) return m;
  for (const k of Object.keys(m) as (keyof Morphology)[]) m[k] = num(v[k], m[k], -1, 1);
  return m;
}

function marks(v: unknown): Marks {
  const m = emptyMarks();
  if (!isObj(v)) return m;
  for (const k of Object.keys(m) as (keyof Marks)[]) m[k] = num(v[k], m[k], 0, 12);
  return m;
}

function hourRecords(v: unknown): HourRecord[] {
  if (!Array.isArray(v)) return [];
  const out: HourRecord[] = [];
  for (const r of v) {
    if (!isObj(r) || typeof r.t !== 'number') continue;
    out.push({
      t: r.t,
      T: num(r.T, 10, -90, 60),
      W: num(r.W, 0, 0, 400),
      D: num(r.D, 0, 0, 360),
      P: num(r.P, 0, 0, 500),
      H: num(r.H, 70, 0, 100),
      C: num(r.C, 50, 0, 100),
      c: num(r.c, 0, 0, 99),
      d: r.d ? 1 : 0,
      l: typeof r.l === 'string' ? r.l : 'unknown',
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

function memory(v: unknown): EnvironmentMemory {
  const m = createMemory();
  if (!isObj(v)) return m;
  m.records = hourRecords(v.records);
  m.processedUntil = typeof v.processedUntil === 'number' ? v.processedUntil : null;
  if (isObj(v.exposure)) {
    const e = v.exposure;
    m.exposure = {
      short: features(e.short),
      medium: features(e.medium),
      long: features(e.long),
      deep: features(e.deep),
      volatility: num(e.volatility, 0.2, 0, 1),
      observedHours: num(e.observedHours, 0, 0),
    };
  }
  if (Array.isArray(v.gaps)) m.gaps = v.gaps.filter(isObj).map((g) => ({
    from: num(g.from, 0), to: num(g.to, 0), hours: num(g.hours, 0, 0),
    reason: g.reason === 'beyond-catch-up' ? 'beyond-catch-up' as const : 'no-data' as const,
  }));
  if (Array.isArray(v.events)) m.events = v.events.filter(isObj).filter((e) => typeof e.kind === 'string').map((e) => ({
    t: num(e.t, 0), kind: e.kind as EnvironmentMemory['events'][number]['kind'], magnitude: num(e.magnitude, 0), prenatal: !!e.prenatal,
  }));
  if (Array.isArray(v.daily)) m.daily = v.daily.filter(isObj).map((d) => ({
    day: num(d.day, 0), hours: num(d.hours, 0, 0), Tavg: num(d.Tavg, 0), Tmin: num(d.Tmin, 0), Tmax: num(d.Tmax, 0),
    Wavg: num(d.Wavg, 0), Wmax: num(d.Wmax, 0), Ptot: num(d.Ptot, 0), Havg: num(d.Havg, 0), Cavg: num(d.Cavg, 0),
  }));
  if (isObj(v.streaks)) {
    const s = v.streaks;
    m.streaks = { storm: num(s.storm, 0), frost: num(s.frost, 0), heat: num(s.heat, 0), rain: num(s.rain, 0), calm: num(s.calm, 0) };
  }
  m.lastT = typeof v.lastT === 'number' ? v.lastT : null;
  m.lastW = typeof v.lastW === 'number' ? v.lastW : null;
  return m;
}

function interaction(v: unknown, now: number): InteractionMemory {
  const m = createInteractionMemory(now);
  if (!isObj(v)) return m;
  for (const k of Object.keys(m) as (keyof InteractionMemory)[]) m[k] = num(v[k], m[k], 0);
  m.familiarity = Math.min(1, m.familiarity);
  m.wariness = Math.min(1, m.wariness);
  return m;
}

/**
 * Migrate any known older schema to the current one.
 * v1 (pre-release) stored `history` (raw hours) and `adaptation` instead of
 * `memory` and `morphology`; its hours are kept and morphology carried over.
 */
export function migrate(raw: unknown, now = Date.now()): OrganismState {
  if (!isObj(raw)) throw new ImportError('Organism data is not an object');
  const schema = num(raw.schema, 1);
  if (schema > SCHEMA_VERSION) throw new ImportError(`This organism was saved by a newer version of LUMIN (schema ${schema})`);
  if (typeof raw.seed !== 'number' || !Number.isFinite(raw.seed)) throw new ImportError('Organism has no valid seed');

  const src: Record<string, unknown> = { ...raw };
  if (schema < 2) {
    src.memory = isObj(raw.memory) ? raw.memory : { records: raw.history };
    src.morphology = raw.morphology ?? raw.adaptation;
  }

  const o = createOrganism(raw.seed, num(raw.bornAt, now), raw.kind === 'experimental' ? 'experimental' : 'live');
  o.bornAt = num(raw.bornAt, now, 0, now + 60000);
  if (isObj(src.location) && typeof src.location.latitude === 'number' && typeof src.location.longitude === 'number') {
    const l = src.location;
    o.location = {
      id: typeof l.id === 'string' ? l.id : `${(l.latitude as number).toFixed(2)},${(l.longitude as number).toFixed(2)}`,
      name: typeof l.name === 'string' ? l.name : 'Unnamed place',
      region: typeof l.region === 'string' ? l.region : undefined,
      country: typeof l.country === 'string' ? l.country : undefined,
      latitude: num(l.latitude, 0, -90, 90),
      longitude: num(l.longitude, 0, -180, 180),
      timezone: typeof l.timezone === 'string' ? l.timezone : undefined,
      origin: 'import',
    };
  }
  if (Array.isArray(src.locationLog)) {
    o.locationLog = src.locationLog.filter(isObj).map((e) => ({ t: num(e.t, 0), id: String(e.id ?? ''), name: String(e.name ?? '') }));
  }
  o.memory = memory(src.memory);
  if (schema < 2 && o.memory.records.length && o.memory.processedUntil === null) {
    // v1 never tracked processing; treat stored hours as already experienced.
    o.memory.processedUntil = o.memory.records[o.memory.records.length - 1].t + 3600000;
  }
  o.morphology = morphology(src.morphology);
  o.marks = marks(src.marks);
  o.interaction = interaction(src.interaction, now);
  if (Array.isArray(src.snapshots)) {
    o.snapshots = src.snapshots.filter(isObj).map((s) => ({ t: num(s.t, 0), m: morphology(s.m) })).slice(-120);
  }
  if (isObj(src.mood)) {
    const md = src.mood;
    o.mood = {
      energy: num(md.energy, 0.5, 0, 1), curiosity: num(md.curiosity, 0.5, 0, 1), openness: num(md.openness, 0.5, 0, 1),
      cohesion: num(md.cohesion, 0.5, 0, 1), tension: num(md.tension, 0.2, 0, 1), stability: num(md.stability, 0.6, 0, 1),
      comfort: num(md.comfort, 0.6, 0, 1), sensitivity: num(md.sensitivity, 0.5, 0, 1),
    };
  }
  if (isObj(src.ancestral)) {
    o.ancestral = { from: num(src.ancestral.from, 0), to: num(src.ancestral.to, 0), hours: num(src.ancestral.hours, 0, 0) };
  }
  if (isObj(src.previousVisit)) {
    o.previousVisit = { t: num(src.previousVisit.t, 0), m: morphology(src.previousVisit.m) };
  }
  o.savedAt = num(src.savedAt, now);
  o.schema = SCHEMA_VERSION;
  return o;
}

export function toExport(o: OrganismState, now = Date.now()): ExportEnvelope {
  return { format: EXPORT_FORMAT, schema: SCHEMA_VERSION, exportedAt: now, organism: structuredClone(o) };
}

export function fromExport(text: string, now = Date.now()): OrganismState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ImportError('The file is not valid JSON');
  }
  if (!isObj(parsed) || parsed.format !== EXPORT_FORMAT) throw new ImportError('The file is not a LUMIN organism export');
  return migrate(parsed.organism, now);
}
