import { describe, expect, it } from 'vitest';
import { parseCurrent, parseGeocoding, parseHourly } from '../src/weather/validate';
import { planHistoryRequests, MAX_PAST_DAYS } from '../src/weather/openMeteo';
import { classify, LIVE_WINDOW_MS, statusLabel, simulatedConditions } from '../src/weather/service';
import { solarElevation } from '../src/weather/sun';
import { createOrganism, ingestWeather, SCHEMA_VERSION } from '../src/organism/state';
import { fromExport, migrate, toExport, ImportError } from '../src/persistence/serialize';
import { MemoryStore } from '../src/persistence/storage';
import { BehaviourEngine, BEHAVIOUR_KEYS } from '../src/behaviour/engine';
import { createGenome, nameFromSeed } from '../src/organism/genome';
import { createMemory, ingestHours } from '../src/memory/environment';
import { rawToFeatures } from '../src/memory/features';
import { neutralMorphology } from '../src/organism/adaptation';
import { HOUR, T0, hours } from './helpers';

const DAY = 86400000;

describe('weather validation', () => {
  const base = T0 / 1000;
  const hourly = {
    time: [base, base + 3600, base + 7200, base + 10800, base + 14400],
    temperature_2m: [10, 11, null, 999, 12],
    wind_speed_10m: [5, 6, 7, 8, 9],
    wind_direction_10m: [90, 90, 90, 90, 90],
    precipitation: [0, 0.2, 0, 0, 0],
    relative_humidity_2m: [70, 71, 72, 73, 74],
    cloud_cover: [10, 20, 30, 40, 50],
    weather_code: [1, 61, 2, 3, 2],
    is_day: [1, 1, 1, 0, 0],
  };

  it('rejects hours with missing or implausible values instead of patching them', () => {
    const r = parseHourly(hourly, 'x', T0 + 10 * HOUR, () => true);
    expect(r.hours.map((h) => h.T)).toEqual([10, 11, 12]);
    expect(r.rejected).toBe(2);
  });

  it('only accepts completed hours', () => {
    const r = parseHourly(hourly, 'x', T0 + 2 * HOUR + 1, () => true);
    expect(r.hours).toHaveLength(2);
  });

  it('parses current conditions and refuses unusable payloads', () => {
    const c = parseCurrent({
      current: { time: base, temperature_2m: 14, wind_speed_10m: 20, wind_direction_10m: 200, precipitation: 0.4, relative_humidity_2m: 80, cloud_cover: 60, weather_code: 61, is_day: 1 },
      daily: { sunrise: [base - 3600], sunset: [base + 36000] },
    });
    expect(c).toMatchObject({ temperature: 14, windSpeed: 20, isDay: true, sunrise: T0 - HOUR });
    expect(parseCurrent({ current: { time: base, temperature_2m: 'warm' } })).toBeNull();
    expect(parseCurrent(null)).toBeNull();
  });

  it('parses geocoding results defensively', () => {
    const hits = parseGeocoding({ results: [{ name: 'Oslo', latitude: 59.9, longitude: 10.7, country: 'Norway' }, { name: 'Bad', latitude: 200, longitude: 0 }, 'junk'] });
    expect(hits).toHaveLength(1);
    expect(hits[0].country).toBe('Norway');
    expect(parseGeocoding({})).toEqual([]);
  });
});

describe('history catch-up planning', () => {
  const now = T0 + 400 * DAY;
  it('uses the ancestral window for a newborn', () => {
    expect(planHistoryRequests(null, now, 14)).toMatchObject({ pastDays: 14, archive: null });
  });
  it('covers short absences with past_days alone', () => {
    const p = planHistoryRequests(now - 3.2 * DAY, now, 14);
    expect(p.pastDays).toBe(5);
    expect(p.archive).toBeNull();
  });
  it('uses the archive for long absences and reports unrecoverable spans', () => {
    const p = planHistoryRequests(now - 200 * DAY, now, 14);
    expect(p.pastDays).toBe(MAX_PAST_DAYS);
    expect(p.archive).not.toBeNull();
    expect(p.truncatedFrom).toBeNull();
    const far = planHistoryRequests(now - 600 * DAY, now, 14);
    expect(far.truncatedFrom).toBe(now - 600 * DAY);
  });
});

describe('condition labelling', () => {
  it('never labels old data as live', () => {
    const now = T0;
    expect(classify(now - 5 * 60000, now)).toBe('live');
    expect(classify(now - LIVE_WINDOW_MS - 1, now)).toBe('cached');
    const label = statusLabel({ source: 'cached', conditions: simulatedConditions(null, now), fetchedAt: now - 3 * HOUR, lastAttempt: now, lastError: 'x' }, now);
    expect(label).toBe('Cached weather from 3 hours ago');
  });
  it('solar elevation is high at local noon and negative at midnight', () => {
    // Greenwich, near the June solstice.
    const noon = Date.UTC(2026, 5, 21, 12);
    expect(solarElevation(noon, 51.48, 0)).toBeGreaterThan(55);
    expect(solarElevation(noon + 12 * HOUR, 51.48, 0)).toBeLessThan(-5);
  });
});

describe('persistence', () => {
  it('round-trips an organism through export and import', () => {
    const o = createOrganism(0xbeef, T0 + 100 * HOUR);
    ingestWeather(o, hours(24 * 6, { W: 40, P: 1 }));
    o.location = { id: '1.00,2.00', name: 'Here', latitude: 1, longitude: 2, origin: 'search' };
    const text = JSON.stringify(toExport(o, T0));
    const back = fromExport(text, T0 + 200 * HOUR);
    expect(back.seed).toBe(o.seed);
    expect(back.morphology).toEqual(o.morphology);
    expect(back.memory.exposure).toEqual(o.memory.exposure);
    expect(back.memory.processedUntil).toBe(o.memory.processedUntil);
    expect(back.memory.records.length).toBe(o.memory.records.length);
    expect(back.location?.name).toBe('Here');
    expect(back.location?.origin).toBe('import');
  });

  it('continues deterministically after import', () => {
    const o = createOrganism(77, T0);
    ingestWeather(o, hours(48));
    const copy = fromExport(JSON.stringify(toExport(o)));
    const next = hours(48, { W: 60 }, o.memory.processedUntil!);
    ingestWeather(o, next);
    ingestWeather(copy, next);
    expect(copy.morphology).toEqual(o.morphology);
  });

  it('rejects foreign, malformed and future-version files', () => {
    expect(() => fromExport('not json')).toThrow(ImportError);
    expect(() => fromExport(JSON.stringify({ format: 'other' }))).toThrow(ImportError);
    const future = toExport(createOrganism(1, T0));
    (future.organism as unknown as { schema: number }).schema = SCHEMA_VERSION + 1;
    expect(() => fromExport(JSON.stringify(future))).toThrow(/newer version/);
    expect(() => migrate({ schema: 2 })).toThrow(/seed/);
  });

  it('migrates schema 1 data and clamps hostile values', () => {
    const v1 = {
      schema: 1,
      seed: 99,
      bornAt: T0,
      history: hours(5),
      adaptation: { elongation: 0.7, crystal: 50 },
    };
    const o = migrate(v1, T0 + 10 * HOUR);
    expect(o.schema).toBe(SCHEMA_VERSION);
    expect(o.memory.records).toHaveLength(5);
    expect(o.memory.processedUntil).toBe(T0 + 5 * HOUR);
    expect(o.morphology.elongation).toBe(0.7);
    expect(o.morphology.crystal).toBe(1);
    expect(o.morphology.expanse).toBe(neutralMorphology().expanse);
  });

  it('memory store saves and restores structured data', async () => {
    const s = new MemoryStore();
    const o = createOrganism(5, T0);
    await s.set('organism:live', o);
    const back = await s.get<typeof o>('organism:live');
    expect(back?.seed).toBe(5);
    await s.delete('organism:live');
    expect(await s.get('organism:live')).toBeUndefined();
  });
});

describe('identity and behaviour', () => {
  it('the same seed always gives the same individual', () => {
    expect(createGenome(123)).toEqual(createGenome(123));
    expect(nameFromSeed(123)).toBe(nameFromSeed(123));
    expect(createGenome(123).hue).not.toBe(createGenome(124).hue);
  });

  it('keeps every behavioural variable within 0..1 under extreme input', () => {
    const g = createGenome(8);
    const e = new BehaviourEngine(g, null);
    const mem = createMemory();
    ingestHours(mem, hours(48), T0);
    const env = rawToFeatures(45, 150, 0, 40, 100, 100, 1, 95);
    for (let i = 0; i < 600; i++) {
      e.update(1 / 30, {
        env, exposure: mem.exposure, morph: neutralMorphology(), genome: g, familiarity: 1, wariness: 1,
        stimulus: { proximity: 1, speed: 9, impulse: i % 10 === 0 ? 3 : 0, present: true }, idleSeconds: 0,
      });
      for (const k of BEHAVIOUR_KEYS) {
        expect(e.state[k]).toBeGreaterThanOrEqual(0);
        expect(e.state[k]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('comfort depends on acclimatisation, not just current weather', () => {
    const g = createGenome(8);
    const coldMem = createMemory();
    const warmMem = createMemory();
    ingestHours(coldMem, hours(24 * 30, { T: -5 }), T0);
    ingestHours(warmMem, hours(24 * 30, { T: 26 }), T0);
    const chilly = rawToFeatures(-3, 5, 0, 0, 70, 30, 1, 1);
    expect(BehaviourEngine.comfortOf(chilly, coldMem.exposure, g)).toBeGreaterThan(BehaviourEngine.comfortOf(chilly, warmMem.exposure, g) + 0.2);
  });

  it('stays independently active with no stimulus', () => {
    const g = createGenome(21);
    const e = new BehaviourEngine(g, null);
    const mem = createMemory();
    ingestHours(mem, hours(24), T0);
    const env = rawToFeatures(15, 10, 270, 0, 70, 40, 0.8, 2);
    const seen: number[] = [];
    for (let i = 0; i < 3000; i++) {
      e.update(1 / 30, {
        env, exposure: mem.exposure, morph: neutralMorphology(), genome: g, familiarity: 0, wariness: 0,
        stimulus: { proximity: 0, speed: 0, impulse: 0, present: false }, idleSeconds: i / 30,
      });
      if (i % 300 === 0) seen.push(e.state.curiosity);
    }
    const spread = Math.max(...seen) - Math.min(...seen);
    expect(spread).toBeGreaterThan(0.02);
  });
});
