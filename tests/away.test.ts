import { describe, expect, it } from 'vitest';
import { createOrganism, ingestWeather } from '../src/organism/state';
import { awaySummary } from '../src/memory/narrative';
import { HOUR, T0, hours } from './helpers';

function visitedThenAway(awayProfile: Parameters<typeof hours>[1], awayHours: number, gapHours = 0) {
  const o = createOrganism(17, T0);
  ingestWeather(o, hours(48));
  const leftAt = o.memory.processedUntil!;
  o.previousVisit = { t: leftAt, m: { ...o.morphology } };
  ingestWeather(o, hours(awayHours, awayProfile, leftAt + gapHours * HOUR));
  return { o, now: o.memory.processedUntil! };
}

describe('while you were away', () => {
  it('describes the recorded weather and what it changed', () => {
    const { o, now } = visitedThenAway({ W: 72, P: 0.6, T: 9 }, 72);
    const text = awaySummary(o, now, 'Kerein')!;
    expect(text).toMatch(/^While you were away: 3 days with /);
    console.log('SAMPLE', text);
    expect(text).toContain('a storm');
    expect(text).toMatch(/\d+ mm of rain/);
    expect(text).not.toContain('a long rain');
    expect(text).toMatch(/Kerein has (?!kept)/); // a real change is named
    expect(text).not.toContain('could not be recovered');
  });

  it('says so plainly when nothing much changed', () => {
    const { o, now } = visitedThenAway({}, 4);
    const text = awaySummary(o, now, 'Kerein')!;
    expect(text).toContain('settled weather around');
    expect(text).toContain('Kerein has kept its shape.');
  });

  it('names missing hours instead of inventing them', () => {
    const { o, now } = visitedThenAway({}, 10, 30);
    expect(awaySummary(o, now, 'Kerein')).toContain('Weather for 30 of those hours could not be recovered');
  });

  it('stays silent after a short absence', () => {
    const o = createOrganism(17, T0);
    ingestWeather(o, hours(10));
    o.previousVisit = { t: T0 + 9 * HOUR, m: { ...o.morphology } };
    expect(awaySummary(o, T0 + 10 * HOUR, 'Kerein')).toBeNull();
  });
});
