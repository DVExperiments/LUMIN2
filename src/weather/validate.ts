/**
 * Validation of raw Open-Meteo payloads.
 *
 * Every value is range-checked. An hour with any missing or implausible core
 * variable is rejected rather than patched: the memory system treats it as a
 * gap, never as an invented observation.
 */
import type { Conditions, HourRecord } from './types';

export const RANGES = {
  temperature: [-90, 60],
  windSpeed: [0, 400],
  windDirection: [0, 360],
  precipitation: [0, 500],
  humidity: [0, 100],
  cloudCover: [0, 100],
} as const;

type RangeKey = keyof typeof RANGES;

export function validNumber(v: unknown, key: RangeKey): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const [lo, hi] = RANGES[key];
  if (v < lo || v > hi) return null;
  return v;
}

function arr(obj: Record<string, unknown> | undefined, key: string): unknown[] | null {
  const a = obj?.[key];
  return Array.isArray(a) ? a : null;
}

export interface HourlyParseResult {
  hours: HourRecord[];
  rejected: number;
}

/**
 * Parse an Open-Meteo `hourly` block (timeformat=unixtime).
 * `isDayFallback` supplies day/night when the API omits `is_day` (archive endpoint).
 */
export function parseHourly(
  hourly: unknown,
  locationId: string,
  until: number,
  isDayFallback: (t: number) => boolean,
): HourlyParseResult {
  const h = (hourly ?? {}) as Record<string, unknown>;
  const time = arr(h, 'time');
  if (!time) return { hours: [], rejected: 0 };
  const T = arr(h, 'temperature_2m');
  const W = arr(h, 'wind_speed_10m');
  const D = arr(h, 'wind_direction_10m');
  const P = arr(h, 'precipitation');
  const H = arr(h, 'relative_humidity_2m');
  const C = arr(h, 'cloud_cover');
  const code = arr(h, 'weather_code');
  const day = arr(h, 'is_day');

  const hours: HourRecord[] = [];
  let rejected = 0;
  for (let i = 0; i < time.length; i++) {
    const ts = time[i];
    if (typeof ts !== 'number' || !Number.isFinite(ts)) {
      rejected++;
      continue;
    }
    const t = ts * 1000;
    // Only completed hours become memory: the hour must have ended.
    if (t + 3600000 > until) continue;
    const rec = {
      T: validNumber(T?.[i], 'temperature'),
      W: validNumber(W?.[i], 'windSpeed'),
      D: validNumber(D?.[i], 'windDirection'),
      P: validNumber(P?.[i], 'precipitation'),
      H: validNumber(H?.[i], 'humidity'),
      C: validNumber(C?.[i], 'cloudCover'),
    };
    if (rec.T === null || rec.W === null || rec.D === null || rec.P === null || rec.H === null || rec.C === null) {
      rejected++;
      continue;
    }
    const c = typeof code?.[i] === 'number' && Number.isFinite(code[i] as number) ? (code[i] as number) : 0;
    const dRaw = day?.[i];
    const d: 0 | 1 = typeof dRaw === 'number' ? (dRaw ? 1 : 0) : isDayFallback(t) ? 1 : 0;
    hours.push({ t, T: rec.T, W: rec.W, D: rec.D, P: rec.P, H: rec.H, C: rec.C, c, d, l: locationId });
  }
  hours.sort((a, b) => a.t - b.t);
  return { hours, rejected };
}

/** Parse the `current` + `daily` blocks into instantaneous conditions, or null if unusable. */
export function parseCurrent(payload: unknown): Conditions | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  const cur = p.current as Record<string, unknown> | undefined;
  if (!cur || typeof cur.time !== 'number') return null;
  const temperature = validNumber(cur.temperature_2m, 'temperature');
  const windSpeed = validNumber(cur.wind_speed_10m, 'windSpeed');
  const windDirection = validNumber(cur.wind_direction_10m, 'windDirection');
  const precipitation = validNumber(cur.precipitation, 'precipitation');
  const humidity = validNumber(cur.relative_humidity_2m, 'humidity');
  const cloudCover = validNumber(cur.cloud_cover, 'cloudCover');
  if (temperature === null || windSpeed === null || windDirection === null) return null;

  const daily = p.daily as Record<string, unknown> | undefined;
  const sunrise = arr(daily, 'sunrise');
  const sunset = arr(daily, 'sunset');
  const now = (cur.time as number) * 1000;
  const pick = (a: unknown[] | null): number | null => {
    if (!a || !a.length) return null;
    // Choose the entry on the same local day as "now" (the last one not after now + 12h).
    let best: number | null = null;
    for (const v of a) if (typeof v === 'number' && v * 1000 <= now + 43200000) best = v * 1000;
    return best;
  };
  return {
    time: now,
    temperature,
    windSpeed,
    windDirection,
    precipitation: precipitation ?? 0,
    humidity: humidity ?? 70,
    cloudCover: cloudCover ?? 50,
    weatherCode: typeof cur.weather_code === 'number' ? cur.weather_code : 0,
    isDay: cur.is_day === 1,
    sunrise: pick(sunrise),
    sunset: pick(sunset),
  };
}

export interface GeocodeHit {
  name: string;
  region?: string;
  country?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
}

export function parseGeocoding(payload: unknown): GeocodeHit[] {
  const results = (payload as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: GeocodeHit[] = [];
  for (const r of results) {
    const o = r as Record<string, unknown>;
    if (typeof o.name !== 'string' || typeof o.latitude !== 'number' || typeof o.longitude !== 'number') continue;
    if (Math.abs(o.latitude) > 90 || Math.abs(o.longitude) > 180) continue;
    out.push({
      name: o.name,
      region: typeof o.admin1 === 'string' ? o.admin1 : undefined,
      country: typeof o.country === 'string' ? o.country : undefined,
      latitude: o.latitude,
      longitude: o.longitude,
      timezone: typeof o.timezone === 'string' ? o.timezone : undefined,
    });
  }
  return out;
}

/** WMO weather code → plain-language description. */
export function describeCode(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Unsettled';
}
