/**
 * Canvas 2D fallback renderer, used when WebGL2 is unavailable.
 * Draws the same simulation (shared membrane function, filaments, particles)
 * with additive compositing. Less luminous than the GPU path, but complete.
 */
import type { FrameInfo, RenderSettings, Renderer } from './types';
import { OrganismSimulation, PARTICLE_STRIDE, P_RAIN } from '../organism/simulation';
import { TAU } from '../core/math';

function hslCss(h: number, s: number, l: number, a = 1): string {
  return `hsla(${(((h % 1) + 1) % 1) * 360}, ${s * 100}%, ${l * 100}%, ${a})`;
}

export class CanvasRenderer implements Renderer {
  readonly kind = 'canvas2d' as const;
  readonly lost = false;
  readonly gpuMs = null;
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private scale = 1;
  private settings: RenderSettings;

  constructor(private canvas: HTMLCanvasElement, settings: RenderSettings) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
    this.settings = settings;
  }

  configure(settings: RenderSettings) {
    this.settings = settings;
  }

  resize(cssW: number, cssH: number, dpr: number) {
    const s = Math.min(dpr, this.settings.dprCap, 1.25) * Math.min(this.settings.renderScale, 0.85);
    this.w = Math.max(2, Math.round(cssW * s));
    this.h = Math.max(2, Math.round(cssH * s));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
  }

  render(sim: OrganismSimulation, frame: FrameInfo) {
    const ctx = this.ctx;
    const e = sim.expr;
    this.scale = (this.w / 2) / sim.viewX;
    const sx = (x: number) => this.w / 2 + x * this.scale;
    const sy = (y: number) => this.h / 2 - y * this.scale;

    // Atmosphere.
    ctx.globalCompositeOperation = 'source-over';
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    const day = e.daylight;
    const top = `rgb(${Math.round(3 + day * 6)}, ${Math.round(4 + day * 24)}, ${Math.round(13 + day * 28)})`;
    const low = `rgb(${Math.round(8 + day * 14 + (1 - Math.abs(day - 0.5) * 2) * 40)}, ${Math.round(6 + day * 40)}, ${Math.round(18 + day * 38)})`;
    g.addColorStop(0, top);
    g.addColorStop(1, low);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    if (frame.lab) {
      ctx.fillStyle = 'rgba(255, 170, 80, 0.035)';
      ctx.fillRect(0, 0, this.w, this.h);
    }

    ctx.globalCompositeOperation = 'lighter';
    const cx = sx(sim.cx), cy = sy(sim.cy);
    const R = sim.shape.radius * this.scale;

    // Halo.
    const halo = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * (2.6 + e.humidity * 2));
    halo.addColorStop(0, hslCss(e.hue, e.saturation, 0.5, 0.22 * e.glow));
    halo.addColorStop(1, hslCss(e.hue, e.saturation, 0.5, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(cx - R * 5, cy - R * 5, R * 10, R * 10);

    // Filaments.
    ctx.lineCap = 'round';
    for (const f of sim.filaments) {
      if (f.growth < 0.05) continue;
      const n = f.segs;
      ctx.beginPath();
      for (let j = 0; j < n; j++) {
        const o = (f.offset + j) * 3;
        const x = sx(sim.pts[o]), y = sy(sim.pts[o + 1]);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const a = (f.long ? 0.55 : 0.35) * f.growth * (0.6 + e.energy * 0.5);
      ctx.strokeStyle = hslCss(e.hue + f.hueOffset * e.hueSpread, e.saturation, 0.62, a);
      ctx.lineWidth = Math.max(0.6, f.width * this.scale * 1.6);
      ctx.stroke();
    }

    // Membrane path from the shared shape function.
    ctx.beginPath();
    const steps = 96;
    for (let i = 0; i <= steps; i++) {
      const th = (i / steps) * TAU;
      const r = sim.shape.radiusAt(th) * this.scale;
      const x = cx + Math.cos(th) * r, y = cy - Math.sin(th) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const body = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.15);
    body.addColorStop(0, hslCss(e.hue + e.hueSpread, 0.8, 0.75, 0.55 + e.beat * 0.3));
    body.addColorStop(0.35, hslCss(e.hue - e.hueSpread, e.saturation, 0.4, 0.3));
    body.addColorStop(0.9, hslCss(e.hue, e.saturation, 0.5, 0.25));
    body.addColorStop(1, hslCss(e.hue, e.saturation, 0.7, 0.6));
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = hslCss(e.hue, e.saturation, 0.72, 0.8);
    ctx.lineWidth = Math.max(1, R * 0.03);
    ctx.stroke();

    // Particles (motes first, then rain, spores and sparks).
    for (const [out, count] of [[sim.moteOut, sim.moteCount], [sim.particleOut, sim.particleCount]] as const) {
    for (let i = 0; i < count; i++) {
      const o = i * PARTICLE_STRIDE;
      const x = sx(out[o]), y = sy(out[o + 1]);
      const alpha = out[o + 5];
      if (alpha < 0.02) continue;
      if (out[o + 7] === P_RAIN) {
        ctx.strokeStyle = `rgba(160, 190, 220, ${alpha * 0.6})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - out[o + 2] * 8, y + out[o + 3] * 8);
        ctx.stroke();
      } else {
        const sz = Math.max(1, out[o + 4] * 1.8);
        ctx.fillStyle = hslCss(e.hue + out[o + 6] * e.hueSpread, 0.6, 0.7, alpha * 0.8);
        ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      }
    }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  dispose() {}
}
