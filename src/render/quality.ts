/**
 * Quality management: presets plus automatic adjustment.
 *
 * Automatic mode climbs a ladder of five rendering levels. Browsers lock frames
 * to the display refresh (16.7 ms at 60 Hz), so "fast" cannot mean "under X ms":
 * instead the manager learns the display's refresh interval and treats frames
 * that keep pace with it as headroom. It steps up after sustained headroom and
 * down after sustained slowdown, and will not climb back to a level that proved
 * too slow until an exponentially growing wait has passed (1, 2, 4… minutes),
 * so it settles instead of oscillating.
 *
 * Only GPU-side settings change in automatic mode, so the organism never resets.
 */
import { RENDER_PRESETS, type QualityName, type RenderSettings } from './types';

export type QualitySetting = 'auto' | QualityName;

/** Automatic ladder, cheapest first. Level 0 is Eco, 2 is Balanced, 4 is Ultra. */
export const AUTO_LADDER: RenderSettings[] = [
  { ...RENDER_PRESETS.eco },
  { renderScale: 0.75, dprCap: 1.25, bloomLevels: 4, octaves: 3, trails: true, grain: 0.013 },
  { ...RENDER_PRESETS.balanced },
  { renderScale: 1, dprCap: 1.5, bloomLevels: 5, octaves: 4, trails: true, grain: 0.014 },
  { ...RENDER_PRESETS.ultra },
];

export function coarseDevice(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
}

/** Simulation detail (filament segments, particle count) chosen once at start-up. */
export function initialPreset(): QualityName {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4;
  if (coarseDevice() || cores <= 4) return 'eco';
  return 'balanced';
}

/**
 * Starting rung of the automatic ladder. Desktops start in the middle whatever
 * core count the browser reports (privacy-focused browsers under-report it);
 * touch devices start at the bottom. Either way the ladder then adapts quickly.
 */
export function startLevel(): number {
  return coarseDevice() ? 0 : 2;
}

export class QualityManager {
  settings: RenderSettings;
  /** Preset that sets simulation detail. */
  preset: QualityName;
  /** Current level on the automatic ladder (0..4). */
  level: number;
  /** Smoothed frame interval in ms. */
  frameMs = 16.7;
  /** Learned display refresh interval in ms. */
  refreshMs = 16.7;
  private slowFor = 0;
  private fastFor = 0;
  private changed = false;
  private warmup = 1;
  /** Level → clock time (s) before which it may not be tried again after proving too slow. */
  private blocked = new Map<number, number>();
  /** Failures per level; each doubles the wait before that level is retried. */
  private failures = new Map<number, number>();
  private clock = 0;

  constructor(public mode: QualitySetting) {
    this.preset = mode === 'auto' ? initialPreset() : mode;
    this.level = startLevel();
    this.settings = mode === 'auto' ? { ...AUTO_LADDER[this.level] } : { ...RENDER_PRESETS[this.preset] };
  }

  setMode(mode: QualitySetting) {
    this.mode = mode;
    this.preset = mode === 'auto' ? initialPreset() : mode;
    this.level = startLevel();
    this.settings = mode === 'auto' ? { ...AUTO_LADDER[this.level] } : { ...RENDER_PRESETS[this.preset] };
    this.slowFor = this.fastFor = 0;
    this.warmup = 1;
    this.blocked.clear();
    this.failures.clear();
    this.changed = true;
  }

  /** Feed a frame interval; returns true when render settings changed. */
  sample(dtMs: number, dtSeconds: number): boolean {
    this.clock += dtSeconds;
    if (dtMs > 250 || dtMs <= 0) return this.consume(); // tab switch or stall
    this.frameMs += (dtMs - this.frameMs) * 0.05;
    // Refresh interval: the fastest sustained pace seen, relaxing slowly so a
    // display change (e.g. moving to a 144 Hz monitor) is picked up.
    if (this.frameMs < this.refreshMs) this.refreshMs = this.frameMs;
    else this.refreshMs += (this.frameMs - this.refreshMs) * 0.0005;
    this.refreshMs = Math.max(4, this.refreshMs);
    if (this.mode !== 'auto') return this.consume();
    if (this.warmup > 0) {
      this.warmup -= dtSeconds;
      return this.consume();
    }

    const keepingPace = this.frameMs < this.refreshMs * 1.12;
    const slipping = this.frameMs > Math.max(this.refreshMs * 1.3, this.refreshMs + 4);
    if (slipping) {
      this.slowFor += dtSeconds;
      this.fastFor = 0;
    } else if (keepingPace) {
      this.fastFor += dtSeconds;
      this.slowFor = 0;
    } else {
      this.slowFor = Math.max(0, this.slowFor - dtSeconds);
      this.fastFor = Math.max(0, this.fastFor - dtSeconds);
    }

    if (this.slowFor > 1.5 && this.level > 0) {
      const fails = (this.failures.get(this.level) ?? 0) + 1;
      this.failures.set(this.level, fails);
      this.blocked.set(this.level, this.clock + 60 * 2 ** (fails - 1));
      this.setLevel(this.level - 1);
    } else if (this.fastFor > 1.5 && this.level < AUTO_LADDER.length - 1) {
      const next = this.level + 1;
      if (this.clock >= (this.blocked.get(next) ?? 0)) this.setLevel(next);
      this.fastFor = 0;
    }
    return this.consume();
  }

  private setLevel(level: number) {
    this.level = level;
    this.settings = { ...AUTO_LADDER[level] };
    this.slowFor = this.fastFor = 0;
    this.warmup = 1; // let the new level's cost show before judging it
    this.changed = true;
  }

  describe(kind: string): string {
    const fps = Math.round(1000 / this.frameMs);
    const res = `${Math.round(this.settings.renderScale * 100)}% resolution`;
    if (this.mode === 'auto') return `${kind}, automatic level ${this.level + 1} of ${AUTO_LADDER.length} at ${res}, about ${fps} frames per second.`;
    return `${kind}, ${this.preset} preset at ${res}, about ${fps} frames per second.`;
  }

  private consume(): boolean {
    const c = this.changed;
    this.changed = false;
    return c;
  }
}
