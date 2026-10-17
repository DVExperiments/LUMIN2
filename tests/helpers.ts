import type { HourRecord } from '../src/weather/types';

export const HOUR = 3600000;
export const T0 = Date.UTC(2026, 0, 1);

export interface Profile {
  T?: number;
  W?: number;
  D?: number;
  P?: number;
  H?: number;
  C?: number;
  c?: number;
}

/** Generate `n` consecutive hourly records starting at `start`. */
export function hours(n: number, p: Profile = {}, start = T0): HourRecord[] {
  const out: HourRecord[] = [];
  for (let i = 0; i < n; i++) {
    const hod = ((start + i * HOUR) / HOUR) % 24;
    out.push({
      t: start + i * HOUR,
      T: (p.T ?? 14) + 2 * Math.sin(((hod - 9) / 24) * Math.PI * 2),
      W: p.W ?? 10,
      D: p.D ?? 270,
      P: p.P ?? 0,
      H: p.H ?? 70,
      C: p.C ?? 40,
      c: p.c ?? 2,
      d: hod >= 6 && hod < 19 ? 1 : 0,
      l: 'test',
    });
  }
  return out;
}
