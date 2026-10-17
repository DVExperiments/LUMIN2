/**
 * Quality management: presets plus automatic adjustment of render resolution
 * based on measured frame times. Automatic mode only changes GPU-side settings
 * (resolution, bloom depth, noise octaves) so the organism itself never
 * visibly resets.
 */
import { RENDER_PRESETS, type QualityName, type RenderSettings } from './types';

export type QualitySetting = 'auto' | QualityName;

export function initialPreset(): QualityName {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4;
  const mobile = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  if (mobile || cores <= 4) return 'eco';
  return 'balanced';
}

export class QualityManager {
  settings: RenderSettings;
  preset: QualityName;
  /** Smoothed frame time in ms. */
  frameMs = 16.7;
  private slowFor = 0;
  private fastFor = 0;
  private changed = false;

  constructor(public mode: QualitySetting) {
    this.preset = mode === 'auto' ? initialPreset() : mode;
    this.settings = { ...RENDER_PRESETS[this.preset] };
  }

  setMode(mode: QualitySetting) {
    this.mode = mode;
    this.preset = mode === 'auto' ? initialPreset() : mode;
    this.settings = { ...RENDER_PRESETS[this.preset] };
    this.slowFor = this.fastFor = 0;
    this.changed = true;
  }

  /** Feed a frame duration; returns true when render settings changed. */
  sample(dtMs: number, dtSeconds: number): boolean {
    if (dtMs > 250) return this.consume(); // tab switch or stall: ignore
    this.frameMs += (dtMs - this.frameMs) * 0.05;
    if (this.mode !== 'auto') return this.consume();
    if (this.frameMs > 21) {
      this.slowFor += dtSeconds;
      this.fastFor = 0;
    } else if (this.frameMs < 14.5) {
      this.fastFor += dtSeconds;
      this.slowFor = 0;
    } else {
      this.slowFor = this.fastFor = 0;
    }
    const s = this.settings;
    if (this.slowFor > 1.5) {
      this.slowFor = 0;
      if (s.renderScale > 0.5) s.renderScale = Math.max(0.5, +(s.renderScale - 0.1).toFixed(2));
      else if (s.bloomLevels > 3) s.bloomLevels--;
      else if (s.octaves > 2) s.octaves--;
      this.changed = true;
    } else if (this.fastFor > 5) {
      this.fastFor = 0;
      const cap = RENDER_PRESETS[this.preset === 'eco' ? 'balanced' : 'ultra'];
      if (s.octaves < cap.octaves - 1) s.octaves++;
      else if (s.bloomLevels < cap.bloomLevels - 1) s.bloomLevels++;
      else if (s.renderScale < cap.renderScale) s.renderScale = Math.min(cap.renderScale, +(s.renderScale + 0.05).toFixed(2));
      else return this.consume();
      this.changed = true;
    }
    return this.consume();
  }

  private consume(): boolean {
    const c = this.changed;
    this.changed = false;
    return c;
  }
}
