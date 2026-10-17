import { describe, expect, it } from 'vitest';
import { createMemory, ingestHours, markUnrecoverableGap, totalGapHours } from '../src/memory/environment';
import { createOrganism, ingestWeather, cloneOrganism } from '../src/organism/state';
import { morphologyTargets } from '../src/organism/adaptation';
import { HOUR, T0, hours } from './helpers';

describe('environmental memory', () => {
  it('advances processedUntil hour by hour and skips already-processed hours', () => {
    const mem = createMemory();
    const r1 = ingestHours(mem, hours(24), T0);
    expect(r1.added).toBe(24);
    expect(mem.processedUntil).toBe(T0 + 24 * HOUR);
    // Re-sending overlapping data must not double-count.
    const r2 = ingestHours(mem, hours(30), T0);
    expect(r2.added).toBe(6);
    expect(r2.skipped).toBe(24);
    expect(mem.exposure.observedHours).toBe(30);
  });

  it('ignores duplicate hours within one batch', () => {
    const mem = createMemory();
    const h = hours(3);
    ingestHours(mem, [...h, ...h], T0);
    expect(mem.exposure.observedHours).toBe(3);
  });

  it('records missing hours as explicit gaps instead of inventing observations', () => {
    const mem = createMemory();
    ingestHours(mem, hours(10), T0);
    const later = hours(5, {}, T0 + 40 * HOUR);
    const r = ingestHours(mem, later, T0);
    expect(r.gapHours).toBe(30);
    expect(mem.gaps).toHaveLength(1);
    expect(mem.gaps[0]).toMatchObject({ from: T0 + 10 * HOUR, to: T0 + 40 * HOUR, hours: 30, reason: 'no-data' });
    // Only real hours were folded into exposure.
    expect(mem.exposure.observedHours).toBe(15);
  });

  it('marks spans beyond the catch-up horizon as unrecoverable', () => {
    const mem = createMemory();
    ingestHours(mem, hours(2), T0);
    markUnrecoverableGap(mem, T0 + 2 * HOUR, T0 + 500 * HOUR);
    expect(mem.gaps.at(-1)?.reason).toBe('beyond-catch-up');
    expect(totalGapHours(mem)).toBe(498);
    expect(mem.processedUntil).toBe(T0 + 500 * HOUR);
  });

  it('short memory reacts within hours while long memory moves slowly', () => {
    const mem = createMemory();
    ingestHours(mem, hours(24 * 10, { W: 5 }), T0);
    const calmLong = mem.exposure.long.wind;
    ingestHours(mem, hours(12, { W: 70 }, mem.processedUntil!), T0);
    expect(mem.exposure.short.wind - calmLong).toBeGreaterThan(0.5);
    expect(mem.exposure.long.wind - calmLong).toBeLessThan(0.1);
  });

  it('detects and de-duplicates notable events', () => {
    const mem = createMemory();
    const r = ingestHours(mem, hours(24 * 5, { T: -6 }), T0);
    // Five freezing days within the 72 h merge window collapse into two frost events at most.
    const frosts = r.events.filter((e) => e.kind === 'frost');
    expect(frosts.length).toBeGreaterThanOrEqual(1);
    expect(frosts.length).toBeLessThanOrEqual(2);
    const storm = ingestHours(mem, hours(6, { W: 80 }, mem.processedUntil!), T0);
    expect(storm.events.map((e) => e.kind)).toContain('storm');
  });

  it('flags events before birth as prenatal (ancestral climate)', () => {
    const mem = createMemory();
    const birth = T0 + 48 * HOUR;
    ingestHours(mem, hours(12, { W: 80 }), birth);
    expect(mem.events[0].prenatal).toBe(true);
  });

  it('keeps raw detail bounded while summaries persist', () => {
    const mem = createMemory();
    ingestHours(mem, hours(24 * 40), T0);
    expect(mem.records.length).toBeLessThanOrEqual(21 * 24);
    expect(mem.daily.length).toBe(40);
  });
});

describe('adaptation', () => {
  it('is fully deterministic: same seed and history give identical state', () => {
    const a = createOrganism(1234, T0 + 1000 * HOUR);
    const b = createOrganism(1234, T0 + 1000 * HOUR);
    const h = hours(24 * 9, { W: 45, T: 4, P: 0.6 });
    ingestWeather(a, h);
    ingestWeather(b, h);
    expect(JSON.stringify(a.morphology)).toBe(JSON.stringify(b.morphology));
    expect(JSON.stringify(a.memory.exposure)).toBe(JSON.stringify(b.memory.exposure));
    expect(a.marks).toEqual(b.marks);
  });

  it('seven days of strong wind streamline the body along the wind', () => {
    const o = createOrganism(42, T0);
    const before = o.morphology.elongation;
    ingestWeather(o, hours(24 * 7, { W: 55, D: 270 }));
    expect(o.morphology.elongation - before).toBeGreaterThan(0.25);
    // Wind from the west pushes east: the acquired axis points +x.
    expect(o.morphology.axisX).toBeGreaterThan(0.2);
    expect(Math.abs(o.morphology.axisY)).toBeLessThan(0.1);
  });

  it('acquired structure persists after the wind stops, then gradually relaxes', () => {
    const o = createOrganism(42, T0);
    ingestWeather(o, hours(24 * 7, { W: 55 }));
    const windy = o.morphology.elongation;
    ingestWeather(o, hours(24, { W: 3 }, o.memory.processedUntil!));
    const oneCalmDay = o.morphology.elongation;
    ingestWeather(o, hours(24 * 13, { W: 3 }, o.memory.processedUntil!));
    const twoCalmWeeks = o.morphology.elongation;
    expect(oneCalmDay).toBeGreaterThan(windy * 0.75);
    expect(twoCalmWeeks).toBeLessThan(oneCalmDay);
  });

  it('different histories under the same current weather give different organisms', () => {
    const cold = createOrganism(7, T0);
    const warm = createOrganism(7, T0);
    ingestWeather(cold, hours(24 * 14, { T: -8, W: 8 }));
    ingestWeather(warm, hours(24 * 14, { T: 27, W: 8, H: 85 }));
    // Both now experience an identical final day.
    ingestWeather(cold, hours(24, { T: 12 }, cold.memory.processedUntil!));
    ingestWeather(warm, hours(24, { T: 12 }, warm.memory.processedUntil!));
    expect(cold.morphology.crystal - warm.morphology.crystal).toBeGreaterThan(0.3);
    expect(warm.morphology.expanse - cold.morphology.expanse).toBeGreaterThan(0.2);
  });

  it('storms leave growth rings', () => {
    const o = createOrganism(9, T0);
    ingestWeather(o, hours(8, { W: 80 }));
    expect(o.marks.rings).toBeGreaterThan(0.9);
  });

  it('ancestral hours shape the newborn more gently than lived hours', () => {
    const lived = createOrganism(5, T0); // born before the weather
    const ancestral = createOrganism(5, T0 + 1000 * HOUR); // weather is before birth
    const h = hours(24 * 5, { W: 55 });
    ingestWeather(lived, h);
    ingestWeather(ancestral, h);
    expect(ancestral.morphology.elongation).toBeLessThan(lived.morphology.elongation);
    expect(ancestral.morphology.elongation).toBeGreaterThan(0.1);
  });

  it('morphology targets stay within bounds', () => {
    const o = createOrganism(3, T0);
    ingestWeather(o, hours(24 * 20, { T: 45, W: 200, P: 50, H: 100, C: 100 }));
    const t = morphologyTargets(o.memory.exposure);
    for (const [k, v] of Object.entries(t)) {
      const lo = k === 'hueDrift' || k === 'axisX' || k === 'axisY' ? -1 : 0;
      expect(v, k).toBeGreaterThanOrEqual(lo);
      expect(v, k).toBeLessThanOrEqual(1);
    }
  });
});

describe('laboratory isolation', () => {
  it('experiments on a copy never touch the real organism', () => {
    const real = createOrganism(11, T0);
    ingestWeather(real, hours(48));
    const snapshot = JSON.stringify(real);
    const copy = cloneOrganism(real);
    ingestWeather(copy, hours(24 * 7, { W: 90, T: -15, P: 8 }, copy.memory.processedUntil!));
    expect(JSON.stringify(real)).toBe(snapshot);
    expect(copy.morphology.crystal).not.toBe(real.morphology.crystal);
  });
});
