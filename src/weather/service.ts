/**
 * Weather service: decides where conditions come from and labels them honestly.
 *
 *   live       last successful fetch < LIVE_WINDOW_MS ago
 *   cached     we have an older successful fetch; shown with its age
 *   simulated  no real data available at all; a clearly labelled stand-in
 *
 * It also plans history catch-up after the app has been closed: completed
 * hours since the organism's last processed hour are requested (forecast
 * `past_days` for recent weeks, archive for older spans).
 */
import { fetchArchive, fetchForecast, planHistoryRequests, WeatherRequestError } from './openMeteo';
import { solarElevation } from './sun';
import type { ConditionSource, Conditions, GeoLocation, HourRecord } from './types';
import type { KeyValueStore } from '../persistence/storage';

export const LIVE_WINDOW_MS = 30 * 60000;
export const REFRESH_INTERVAL_MS = 15 * 60000;
export const ANCESTRAL_DAYS = 14;

export interface CachedWeather {
  locationId: string;
  current: Conditions;
  fetchedAt: number;
}

export interface WeatherStatus {
  source: ConditionSource;
  conditions: Conditions;
  fetchedAt: number | null;
  lastAttempt: number | null;
  lastError: string | null;
}

export interface AcquireResult {
  current: Conditions;
  hours: HourRecord[];
  fetchedAt: number;
  rejected: number;
  /** Start of a span older than the catch-up horizon, which can never be filled. */
  truncatedFrom: number | null;
  /** Archive request failed; older hours could not be recovered this time. */
  archiveFailed: boolean;
}

export function statusLabel(s: WeatherStatus, now: number): string {
  if (s.source === 'laboratory') return 'Laboratory weather';
  if (s.source === 'simulated') return 'Simulated weather';
  if (s.fetchedAt === null) return 'Waiting for weather';
  const age = formatAge(now - s.fetchedAt);
  if (s.source === 'live') return `Live weather, updated ${age}`;
  return `Cached weather from ${age}`;
}

export function formatAge(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m === 1) return '1 minute ago';
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h === 1) return '1 hour ago';
  if (h < 48) return `${h} hours ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

/** Classify a successful fetch time as live or cached at time `now`. */
export function classify(fetchedAt: number, now: number): 'live' | 'cached' {
  return now - fetchedAt <= LIVE_WINDOW_MS ? 'live' : 'cached';
}

/**
 * A gentle, deterministic stand-in environment used only when there is no real
 * data (offline first run, or no location chosen yet). Always labelled
 * "simulated" and never written into memory.
 */
export function simulatedConditions(loc: GeoLocation | null, now: number): Conditions {
  const lat = loc?.latitude ?? 0;
  const lon = loc?.longitude ?? 0;
  const el = solarElevation(now, lat, lon);
  const seasonal = 14 - Math.abs(lat) * 0.18;
  const temperature = seasonal + Math.max(-4, Math.min(6, el / 8));
  return {
    time: now,
    temperature,
    windSpeed: 9 + 4 * Math.sin(now / 3.6e6),
    windDirection: 250,
    precipitation: 0,
    humidity: 72,
    cloudCover: 40,
    weatherCode: 2,
    isDay: el > -0.83,
    sunrise: null,
    sunset: null,
  };
}

export class WeatherService {
  status: WeatherStatus;
  private inflight: Promise<AcquireResult> | null = null;
  private simLoc: GeoLocation | null = null;

  constructor(private store: KeyValueStore) {
    this.status = {
      source: 'simulated',
      conditions: simulatedConditions(null, Date.now()),
      fetchedAt: null,
      lastAttempt: null,
      lastError: null,
    };
  }

  /** Restore cached conditions for a location (labelled cached/live by age). */
  async restore(loc: GeoLocation | null, now: number): Promise<void> {
    this.simLoc = loc;
    if (!loc) {
      this.status = { ...this.status, source: 'simulated', conditions: simulatedConditions(null, now), fetchedAt: null };
      return;
    }
    let cached: CachedWeather | undefined;
    try {
      cached = await this.store.get<CachedWeather>('weather:cache');
    } catch {
      cached = undefined;
    }
    if (cached && cached.locationId === loc.id && cached.current) {
      this.status = {
        source: classify(cached.fetchedAt, now),
        conditions: cached.current,
        fetchedAt: cached.fetchedAt,
        lastAttempt: null,
        lastError: null,
      };
    } else {
      this.status = { source: 'simulated', conditions: simulatedConditions(loc, now), fetchedAt: null, lastAttempt: null, lastError: null };
    }
  }

  /** Re-evaluate the label as time passes (live data ages into cached). */
  tick(now: number) {
    if (this.status.fetchedAt !== null && (this.status.source === 'live' || this.status.source === 'cached')) {
      this.status.source = classify(this.status.fetchedAt, now);
    }
    if (this.status.source === 'simulated' && this.status.fetchedAt === null) {
      // Keep the stand-in's diurnal cycle moving.
      if (now - this.status.conditions.time > 60000) {
        this.status.conditions = simulatedConditions(this.simLoc, now);
      }
    }
  }

  needsRefresh(now: number): boolean {
    if (this.inflight) return false;
    const last = this.status.lastAttempt ?? 0;
    const backoff = this.status.lastError ? 2 * 60000 : REFRESH_INTERVAL_MS;
    return now - last >= backoff;
  }

  /**
   * Fetch current conditions plus every completed hour since `since`
   * (or the ancestral window for a newborn). On failure the previous status is kept,
   * and its label degrades from live to cached by age.
   */
  acquire(loc: GeoLocation, since: number | null, now: number): Promise<AcquireResult> {
    if (this.inflight) return this.inflight;
    this.simLoc = loc;
    this.status.lastAttempt = now;
    const run = async (): Promise<AcquireResult> => {
      const plan = planHistoryRequests(since, now, ANCESTRAL_DAYS);
      let archiveHours: HourRecord[] = [];
      let archiveFailed = false;
      let rejected = 0;
      if (plan.archive) {
        try {
          const a = await fetchArchive(loc, plan.archive.from, plan.archive.to);
          archiveHours = a.hours;
          rejected += a.rejected;
        } catch {
          archiveFailed = true;
        }
      }
      const f = await fetchForecast(loc, plan.pastDays, now);
      rejected += f.rejected;
      const hours = archiveHours.concat(f.hours);
      this.status = {
        source: 'live',
        conditions: f.current,
        fetchedAt: f.fetchedAt,
        lastAttempt: now,
        lastError: null,
      };
      try {
        await this.store.set<CachedWeather>('weather:cache', { locationId: loc.id, current: f.current, fetchedAt: f.fetchedAt });
      } catch {
        /* caching is best-effort */
      }
      return { current: f.current, hours, fetchedAt: f.fetchedAt, rejected, truncatedFrom: plan.truncatedFrom, archiveFailed };
    };
    this.inflight = run()
      .catch((e: unknown) => {
        this.status.lastError = e instanceof WeatherRequestError ? e.message : 'Weather unavailable';
        if (this.status.fetchedAt !== null) this.status.source = classify(this.status.fetchedAt, now);
        else {
          this.status.source = 'simulated';
          this.status.conditions = simulatedConditions(loc, now);
        }
        throw e;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  get busy() {
    return this.inflight !== null;
  }
}
