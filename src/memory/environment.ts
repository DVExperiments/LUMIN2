/**
 * Environmental memory.
 *
 * Hourly observations are folded, in strict time order, into exponential moving
 * averages on four timescales. The same sequence of hours always produces the
 * same memory (fully deterministic), so state can be recomputed and tested.
 *
 *   short   τ = 6 hours    recent mood and energy
 *   medium  τ = 3 days     behavioural tendencies
 *   long    τ = 7 days     morphology targets
 *   deep    τ = 30 days    acclimatisation and identity drift
 *
 * Time only advances on *observed* hours. Hours without data are recorded as
 * explicit gaps and contribute nothing: the organism is treated as dormant
 * rather than fed invented weather.
 */
import { emaWeight } from '../core/math';
import { FEATURE_KEYS, emptyFeatures, hourToFeatures, neutralFeatures, type Features } from './features';
import type { HourRecord } from '../weather/types';

export const HOUR = 3600000;
export const DAY = 86400000;

export const TIMESCALE_HOURS = { short: 6, medium: 72, long: 168, deep: 720 } as const;
export type Timescale = keyof typeof TIMESCALE_HOURS;

/** Keep this many days of raw hours for the observatory timeline. Older detail lives in daily summaries. */
export const RAW_RETENTION_DAYS = 21;
export const DAILY_RETENTION_DAYS = 400;
export const MAX_GAPS = 60;
export const MAX_EVENTS = 80;

export interface Exposure {
  short: Features;
  medium: Features;
  long: Features;
  deep: Features;
  /** Medium-timescale variability of temperature and wind (0..1). */
  volatility: number;
  observedHours: number;
}

export interface GapRecord {
  from: number;
  to: number;
  hours: number;
  reason: 'no-data' | 'beyond-catch-up';
}

export type EventKind = 'storm' | 'frost' | 'heat' | 'deluge' | 'long-rain' | 'stillness';

export interface WeatherEvent {
  t: number;
  kind: EventKind;
  magnitude: number;
  /** True if the event happened before the organism was born (ancestral climate). */
  prenatal: boolean;
}

export interface DailySummary {
  day: number;
  hours: number;
  Tavg: number;
  Tmin: number;
  Tmax: number;
  Wavg: number;
  Wmax: number;
  Ptot: number;
  Havg: number;
  Cavg: number;
}

interface Streaks {
  storm: number;
  frost: number;
  heat: number;
  rain: number;
  calm: number;
}

export interface EnvironmentMemory {
  records: HourRecord[];
  /** End (exclusive) of the last processed hour, or null before any data. */
  processedUntil: number | null;
  exposure: Exposure;
  gaps: GapRecord[];
  events: WeatherEvent[];
  daily: DailySummary[];
  streaks: Streaks;
  /** Last temperature/wind seen, for volatility. */
  lastT: number | null;
  lastW: number | null;
}

export function createMemory(): EnvironmentMemory {
  return {
    records: [],
    processedUntil: null,
    exposure: {
      short: neutralFeatures(),
      medium: neutralFeatures(),
      long: neutralFeatures(),
      deep: neutralFeatures(),
      volatility: 0.2,
      observedHours: 0,
    },
    gaps: [],
    events: [],
    daily: [],
    streaks: { storm: 0, frost: 0, heat: 0, rain: 0, calm: 0 },
    lastT: null,
    lastW: null,
  };
}

export interface IngestHooks {
  /** Called once per processed hour, after exposure is updated. */
  onHour?(features: Features, hour: HourRecord, exposure: Exposure): void;
  onEvent?(event: WeatherEvent): void;
}

export interface IngestReport {
  added: number;
  skipped: number;
  gapHours: number;
  events: WeatherEvent[];
}

const scratch = emptyFeatures();

function updateEma(target: Features, f: Features, w: number) {
  for (const k of FEATURE_KEYS) target[k] += (f[k] - target[k]) * w;
}

function addGap(mem: EnvironmentMemory, from: number, to: number, reason: GapRecord['reason']) {
  const hours = Math.round((to - from) / HOUR);
  if (hours <= 0) return;
  const last = mem.gaps[mem.gaps.length - 1];
  if (last && last.to === from && last.reason === reason) {
    last.to = to;
    last.hours += hours;
  } else {
    mem.gaps.push({ from, to, hours, reason });
    if (mem.gaps.length > MAX_GAPS) mem.gaps.shift();
  }
}

/** Record a span that could not be covered at all (e.g. beyond the catch-up horizon). */
export function markUnrecoverableGap(mem: EnvironmentMemory, from: number, to: number) {
  addGap(mem, from, to, 'beyond-catch-up');
  mem.processedUntil = Math.max(mem.processedUntil ?? to, to);
}

function emitEvent(mem: EnvironmentMemory, ev: WeatherEvent, report: IngestReport, hooks?: IngestHooks) {
  // Merge with a recent event of the same kind (72 h) so a cold week is one frost, not seven.
  for (let i = mem.events.length - 1; i >= 0; i--) {
    const e = mem.events[i];
    if (ev.t - e.t > 72 * HOUR) break;
    if (e.kind === ev.kind) {
      e.magnitude = Math.max(e.magnitude, ev.magnitude);
      return;
    }
  }
  mem.events.push(ev);
  if (mem.events.length > MAX_EVENTS) mem.events.shift();
  report.events.push(ev);
  hooks?.onEvent?.(ev);
}

function updateDaily(mem: EnvironmentMemory, h: HourRecord) {
  const day = Math.floor(h.t / DAY) * DAY;
  let d = mem.daily[mem.daily.length - 1];
  if (!d || d.day !== day) {
    d = { day, hours: 0, Tavg: 0, Tmin: h.T, Tmax: h.T, Wavg: 0, Wmax: 0, Ptot: 0, Havg: 0, Cavg: 0 };
    mem.daily.push(d);
    const cutoff = day - DAILY_RETENTION_DAYS * DAY;
    while (mem.daily.length && mem.daily[0].day < cutoff) mem.daily.shift();
  }
  const n = d.hours + 1;
  d.Tavg += (h.T - d.Tavg) / n;
  d.Wavg += (h.W - d.Wavg) / n;
  d.Havg += (h.H - d.Havg) / n;
  d.Cavg += (h.C - d.Cavg) / n;
  d.Tmin = Math.min(d.Tmin, h.T);
  d.Tmax = Math.max(d.Tmax, h.T);
  d.Wmax = Math.max(d.Wmax, h.W);
  d.Ptot += h.P;
  d.hours = n;
}

/**
 * Fold new hourly records into memory. Records already processed are skipped,
 * duplicates are ignored, and holes in the timeline become explicit gaps.
 */
export function ingestHours(
  mem: EnvironmentMemory,
  hours: HourRecord[],
  birth: number,
  hooks?: IngestHooks,
): IngestReport {
  const report: IngestReport = { added: 0, skipped: 0, gapHours: 0, events: [] };
  const sorted = [...hours].sort((a, b) => a.t - b.t);
  const ex = mem.exposure;
  const wS = emaWeight(1, TIMESCALE_HOURS.short);
  const wM = emaWeight(1, TIMESCALE_HOURS.medium);
  const wL = emaWeight(1, TIMESCALE_HOURS.long);
  const wD = emaWeight(1, TIMESCALE_HOURS.deep);
  let lastT = -Infinity;

  for (const h of sorted) {
    if (h.t === lastT) continue; // duplicate within batch
    if (mem.processedUntil !== null && h.t < mem.processedUntil) {
      report.skipped++;
      continue;
    }
    if (h.t % HOUR !== 0) {
      report.skipped++;
      continue;
    }
    lastT = h.t;
    if (mem.processedUntil !== null && h.t > mem.processedUntil) {
      addGap(mem, mem.processedUntil, h.t, 'no-data');
      report.gapHours += Math.round((h.t - mem.processedUntil) / HOUR);
    }

    const f = hourToFeatures(h, scratch);
    if (ex.observedHours === 0) {
      // First ever observation: seed the fast scales so the organism doesn't spend days "arriving".
      for (const k of FEATURE_KEYS) {
        ex.short[k] = f[k];
        ex.medium[k] = (ex.medium[k] + f[k]) / 2;
      }
    }
    updateEma(ex.short, f, wS);
    updateEma(ex.medium, f, wM);
    updateEma(ex.long, f, wL);
    updateEma(ex.deep, f, wD);

    if (mem.lastT !== null && mem.lastW !== null) {
      const dv = Math.min(1, Math.abs(h.T - mem.lastT) / 3 + Math.abs(h.W - mem.lastW) / 25);
      ex.volatility += (dv - ex.volatility) * wM;
    }
    mem.lastT = h.T;
    mem.lastW = h.W;
    ex.observedHours++;

    // Streak-based event detection.
    const s = mem.streaks;
    const prenatal = h.t < birth;
    s.storm = f.storm > 0.5 ? s.storm + 1 : 0;
    s.frost = h.T <= -1 ? s.frost + 1 : 0;
    s.heat = h.T >= 30 ? s.heat + 1 : 0;
    s.rain = h.P >= 0.2 ? s.rain + 1 : 0;
    s.calm = h.W < 6 ? s.calm + 1 : 0;
    if (s.storm === 3) emitEvent(mem, { t: h.t, kind: 'storm', magnitude: h.W, prenatal }, report, hooks);
    if (s.frost === 3) emitEvent(mem, { t: h.t, kind: 'frost', magnitude: -h.T, prenatal }, report, hooks);
    if (s.heat === 3) emitEvent(mem, { t: h.t, kind: 'heat', magnitude: h.T, prenatal }, report, hooks);
    if (s.rain === 12) emitEvent(mem, { t: h.t, kind: 'long-rain', magnitude: s.rain, prenatal }, report, hooks);
    if (h.P >= 5) emitEvent(mem, { t: h.t, kind: 'deluge', magnitude: h.P, prenatal }, report, hooks);
    if (s.calm === 36) emitEvent(mem, { t: h.t, kind: 'stillness', magnitude: 36, prenatal }, report, hooks);

    updateDaily(mem, h);
    mem.records.push(h);
    mem.processedUntil = h.t + HOUR;
    report.added++;
    hooks?.onHour?.(f, h, ex);
  }

  // Trim raw detail; the EMAs and daily summaries keep the meaning.
  if (mem.processedUntil !== null) {
    const cutoff = mem.processedUntil - RAW_RETENTION_DAYS * DAY;
    let i = 0;
    while (i < mem.records.length && mem.records[i].t < cutoff) i++;
    if (i) mem.records.splice(0, i);
  }
  return report;
}

/** Average of the raw records over the last `hours` (null if none). */
export function recentAverage(mem: EnvironmentMemory, hours: number) {
  if (!mem.records.length || mem.processedUntil === null) return null;
  const since = mem.processedUntil - hours * HOUR;
  let n = 0, T = 0, W = 0, P = 0, H = 0, C = 0;
  for (let i = mem.records.length - 1; i >= 0; i--) {
    const r = mem.records[i];
    if (r.t < since) break;
    n++; T += r.T; W += r.W; P += r.P; H += r.H; C += r.C;
  }
  if (!n) return null;
  return { hours: n, T: T / n, W: W / n, Ptot: P, H: H / n, C: C / n };
}

export function totalGapHours(mem: EnvironmentMemory, since = -Infinity): number {
  let n = 0;
  for (const g of mem.gaps) if (g.to > since) n += g.hours;
  return n;
}
