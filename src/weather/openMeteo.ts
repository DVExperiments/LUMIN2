/**
 * Weather acquisition from Open-Meteo (free, no key, CORS-enabled).
 *   - Geocoding:  https://geocoding-api.open-meteo.com/v1/search
 *   - Forecast:   https://api.open-meteo.com/v1/forecast   (current + up to 92 past days hourly)
 *   - Archive:    https://archive-api.open-meteo.com/v1/archive (older history, ~5 day delay)
 *
 * Only coordinates and a city search term ever leave the browser.
 */
import { parseCurrent, parseGeocoding, parseHourly, type GeocodeHit } from './validate';
import { solarElevation } from './sun';
import type { ForecastResult, GeoLocation, HourRecord } from './types';

const HOURLY_VARS =
  'temperature_2m,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m';
const CURRENT_VARS = HOURLY_VARS + ',is_day';

export const MAX_PAST_DAYS = 92;
/** Archive data lags real time by several days; the forecast endpoint covers the recent part. */
const ARCHIVE_LAG_DAYS = 6;
/** Never reach back further than this when catching up after a long absence. */
export const MAX_CATCH_UP_DAYS = 400;

export class WeatherRequestError extends Error {
  constructor(message: string, readonly kind: 'network' | 'http' | 'parse' | 'timeout') {
    super(message);
  }
}

async function getJson(url: string, timeoutMs = 12000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new WeatherRequestError(`Weather service answered ${res.status}`, 'http');
    try {
      return await res.json();
    } catch {
      throw new WeatherRequestError('Weather service sent unreadable data', 'parse');
    }
  } catch (e) {
    if (e instanceof WeatherRequestError) throw e;
    if ((e as Error).name === 'AbortError') throw new WeatherRequestError('Weather service timed out', 'timeout');
    throw new WeatherRequestError('Weather service unreachable', 'network');
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (e instanceof WeatherRequestError && e.kind === 'http') break;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw last;
}

export function locationId(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

export function hitToLocation(hit: GeocodeHit, origin: GeoLocation['origin']): GeoLocation {
  return { id: locationId(hit.latitude, hit.longitude), origin, ...hit };
}

export async function searchLocations(query: string): Promise<GeocodeHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=7&language=en&format=json`;
  return parseGeocoding(await withRetry(() => getJson(url, 8000)));
}

export async function fetchForecast(loc: GeoLocation, pastDays: number, now = Date.now()): Promise<ForecastResult> {
  const days = Math.max(1, Math.min(MAX_PAST_DAYS, Math.ceil(pastDays)));
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
    `&current=${CURRENT_VARS}&hourly=${HOURLY_VARS},is_day&daily=sunrise,sunset` +
    `&past_days=${days}&forecast_days=1&timezone=auto&timeformat=unixtime&wind_speed_unit=kmh`;
  const payload = await withRetry(() => getJson(url));
  const current = parseCurrent(payload);
  if (!current) throw new WeatherRequestError('Current conditions missing from response', 'parse');
  const { hours, rejected } = parseHourly(
    (payload as Record<string, unknown>).hourly,
    loc.id,
    now,
    (t) => solarElevation(t, loc.latitude, loc.longitude) > -0.83,
  );
  return { current, hours, fetchedAt: now, rejected };
}

function isoDate(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** Fetch archived hourly history for [from, to). Returns validated hours. */
export async function fetchArchive(loc: GeoLocation, from: number, to: number): Promise<{ hours: HourRecord[]; rejected: number }> {
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${loc.latitude}&longitude=${loc.longitude}` +
    `&start_date=${isoDate(from)}&end_date=${isoDate(to)}&hourly=${HOURLY_VARS}&timezone=GMT&timeformat=unixtime&wind_speed_unit=kmh`;
  const payload = await withRetry(() => getJson(url, 20000));
  const res = parseHourly(
    (payload as Record<string, unknown>).hourly,
    loc.id,
    to,
    (t) => solarElevation(t, loc.latitude, loc.longitude) > -0.83,
  );
  res.hours = res.hours.filter((h) => h.t >= from);
  return res;
}

/**
 * Plan which requests are needed to cover history since `since`.
 * Recent days come from the forecast endpoint's `past_days`; anything older than
 * that window (and within MAX_CATCH_UP_DAYS) comes from the archive endpoint.
 */
export function planHistoryRequests(since: number | null, now: number, defaultDays: number) {
  const dayMs = 86400000;
  if (since === null) return { pastDays: defaultDays, archive: null as null | { from: number; to: number }, truncatedFrom: null as number | null };
  const gapDays = (now - since) / dayMs;
  const pastDays = Math.max(1, Math.min(MAX_PAST_DAYS, Math.ceil(gapDays) + 1));
  let archive: { from: number; to: number } | null = null;
  let truncatedFrom: number | null = null;
  if (gapDays > MAX_PAST_DAYS - 1) {
    const earliest = now - MAX_CATCH_UP_DAYS * dayMs;
    const from = Math.max(since, earliest);
    if (since < earliest) truncatedFrom = since;
    const to = Math.min(now - ARCHIVE_LAG_DAYS * dayMs, now - (MAX_PAST_DAYS - 1) * dayMs);
    if (to > from) archive = { from, to };
  }
  return { pastDays, archive, truncatedFrom };
}
