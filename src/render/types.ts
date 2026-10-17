import type { OrganismSimulation } from '../organism/simulation';

export type QualityName = 'eco' | 'balanced' | 'ultra';

export interface RenderSettings {
  /** Fraction of device pixels rendered (adaptive). */
  renderScale: number;
  dprCap: number;
  bloomLevels: number;
  octaves: number;
  trails: boolean;
  grain: number;
}

export const RENDER_PRESETS: Record<QualityName, RenderSettings> = {
  eco: { renderScale: 0.6, dprCap: 1, bloomLevels: 4, octaves: 3, trails: true, grain: 0.012 },
  balanced: { renderScale: 0.85, dprCap: 1.5, bloomLevels: 5, octaves: 4, trails: true, grain: 0.014 },
  ultra: { renderScale: 1, dprCap: 2, bloomLevels: 6, octaves: 5, trails: true, grain: 0.014 },
};

export interface FrameInfo {
  lab: boolean;
  reducedMotion: boolean;
  fogX: number;
  fogY: number;
}

export interface Renderer {
  readonly kind: 'webgl2' | 'canvas2d';
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  configure(settings: RenderSettings): void;
  render(sim: OrganismSimulation, frame: FrameInfo): void;
  /** True if the GPU context is currently lost. */
  readonly lost: boolean;
  /** Smoothed GPU time per frame in ms, when the browser exposes GPU timer queries. */
  readonly gpuMs: number | null;
  dispose(): void;
}
