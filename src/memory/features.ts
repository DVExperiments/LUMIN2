/**
 * Environmental features: raw weather mapped onto perceptual 0..1 axes
 * with smooth, saturating response curves. These are what the organism "feels".
 */
import { clamp, degToRad, smoothstep } from '../core/math';
import type { Conditions, HourRecord } from '../weather/types';

export const FEATURE_KEYS = [
  'warmth', // 0 at −10 °C, 1 at 35 °C
  'frost', // how far below freezing
  'heat', // how far above ~28 °C
  'wind', // saturating wind strength
  'windX', // wind-weighted direction vector (where the wind blows TO), x east
  'windY', // y north
  'rain', // saturating precipitation intensity
  'humidity',
  'cloud',
  'light', // daylight
  'storm', // thunder or gale
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Record<FeatureKey, number>;
export const FEATURE_COUNT = FEATURE_KEYS.length;

export function emptyFeatures(): Features {
  const f = {} as Features;
  for (const k of FEATURE_KEYS) f[k] = 0;
  return f;
}

/** Neutral starting point for a newborn with no environmental context at all. */
export function neutralFeatures(): Features {
  return {
    warmth: 0.55,
    frost: 0,
    heat: 0,
    wind: 0.3,
    windX: 0,
    windY: 0,
    rain: 0.08,
    humidity: 0.65,
    cloud: 0.5,
    light: 0.5,
    storm: 0,
  };
}

export function rawToFeatures(
  temperature: number,
  windSpeed: number,
  windDirectionFrom: number,
  precipitation: number,
  humidity: number,
  cloudCover: number,
  daylight: number,
  weatherCode: number,
  out: Features = emptyFeatures(),
): Features {
  const wind = 1 - Math.exp(-windSpeed / 28);
  // Meteorological direction is where wind comes FROM; convert to the direction it pushes.
  const to = degToRad(windDirectionFrom + 180);
  out.warmth = clamp((temperature + 10) / 45);
  out.frost = smoothstep(2, -8, temperature);
  out.heat = smoothstep(26, 36, temperature);
  out.wind = wind;
  out.windX = Math.sin(to) * wind;
  out.windY = Math.cos(to) * wind;
  out.rain = 1 - Math.exp(-precipitation / 1.6);
  out.humidity = clamp(humidity / 100);
  out.cloud = clamp(cloudCover / 100);
  out.light = clamp(daylight);
  out.storm = Math.max(weatherCode >= 95 ? 1 : 0, smoothstep(45, 75, windSpeed));
  return out;
}

export function hourToFeatures(h: HourRecord, out?: Features): Features {
  return rawToFeatures(h.T, h.W, h.D, h.P, h.H, h.C, h.d, h.c, out);
}

export function conditionsToFeatures(c: Conditions, daylight: number, out?: Features): Features {
  return rawToFeatures(
    c.temperature,
    c.windSpeed,
    c.windDirection,
    c.precipitation,
    c.humidity,
    c.cloudCover,
    daylight,
    c.weatherCode,
    out,
  );
}

export function copyFeatures(src: Features, dst: Features = emptyFeatures()): Features {
  for (const k of FEATURE_KEYS) dst[k] = src[k];
  return dst;
}

export function blendFeatures(a: Features, b: Features, t: number, out: Features = emptyFeatures()): Features {
  for (const k of FEATURE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}
