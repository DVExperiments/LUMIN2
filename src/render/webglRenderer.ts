/**
 * WebGL2 renderer.
 *
 * Passes per frame:
 *   1. Trail buffer: fade the previous frame, add particles (spores, motes, rain, sparks).
 *   2. Scene buffer (HDR): membrane body + filament ribbons + the trail buffer, additive.
 *   3. Bloom: dual-filter downsample/upsample chain from the scene.
 *   4. Composite: weather-driven atmosphere, scene, bloom, ripple refraction,
 *      ACES tone mapping, vignette and grain.
 */
import { GLProgram, createTarget, deleteTarget, hsl, type RenderTarget } from './gl';
import {
  BODY_FS, BODY_VS, COMPOSITE_FS, COPY_FS, DOWN_FS, FADE_FS, FIL_FS, FIL_VS, PART_FS, PART_VS, QUAD_VS, UP_FS,
} from './shaders';
import type { FrameInfo, RenderSettings, Renderer } from './types';
import { MAX_RIPPLES, OrganismSimulation, PARTICLE_STRIDE } from '../organism/simulation';
import { HARMONICS } from '../organism/shape';
import { clamp } from '../core/math';

const FIL_FLOATS = 6;

export class WebGLRenderer implements Renderer {
  readonly kind = 'webgl2' as const;
  lost = false;
  private gl: WebGL2RenderingContext;
  private hdr = false;
  private settings!: RenderSettings;
  private progBody!: GLProgram;
  private progFil!: GLProgram;
  private progPart!: GLProgram;
  private progFade!: GLProgram;
  private progCopy!: GLProgram;
  private progDown!: GLProgram;
  private progUp!: GLProgram;
  private progComp!: GLProgram;
  private quadVao!: WebGLVertexArrayObject;
  private filVao!: WebGLVertexArrayObject;
  private filVbo!: WebGLBuffer;
  private filIbo!: WebGLBuffer;
  private partVao!: WebGLVertexArrayObject;
  private partVbo!: WebGLBuffer;
  private filData = new Float32Array(0);
  private filIndex = new Uint16Array(0);
  private scene: RenderTarget | null = null;
  private trailA: RenderTarget | null = null;
  private trailB: RenderTarget | null = null;
  private bloom: RenderTarget[] = [];
  private width = 1;
  private height = 1;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private colors = new Float32Array(15);
  private ripples = new Float32Array(MAX_RIPPLES * 4);
  private amp = new Float32Array(HARMONICS);
  private phase = new Float32Array(HARMONICS);
  private builtOctaves = -1;

  constructor(private canvas: HTMLCanvasElement, settings: RenderSettings) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);
    this.init(settings);
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };

  private onRestored = () => {
    this.builtOctaves = -1;
    this.scene = this.trailA = this.trailB = null;
    this.bloom = [];
    this.init(this.settings);
    this.resize(this.cssW, this.cssH, this.dpr);
    this.lost = false;
  };

  private init(settings: RenderSettings) {
    const gl = this.gl;
    this.hdr = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    this.settings = settings;
    this.buildPrograms(settings.octaves);
    this.progFil = new GLProgram(gl, FIL_VS, FIL_FS, 'filament');
    this.progPart = new GLProgram(gl, PART_VS, PART_FS, 'particle');
    this.progFade = new GLProgram(gl, QUAD_VS, FADE_FS, 'fade');
    this.progCopy = new GLProgram(gl, QUAD_VS, COPY_FS, 'copy');
    this.progDown = new GLProgram(gl, QUAD_VS, DOWN_FS, 'down');
    this.progUp = new GLProgram(gl, QUAD_VS, UP_FS, 'up');

    // Fullscreen quad (also used, scaled, for the body).
    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    const qb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Filaments.
    this.filVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.filVao);
    this.filVbo = gl.createBuffer()!;
    this.filIbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.filVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, FIL_FLOATS * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, FIL_FLOATS * 4, 8);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.filIbo);

    // Particles: shared corner quad + per-instance data.
    this.partVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.partVao);
    const cb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.partVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partVbo);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, PARTICLE_STRIDE * 4, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, PARTICLE_STRIDE * 4, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }

  private buildPrograms(octaves: number) {
    if (octaves === this.builtOctaves) return;
    this.progBody?.dispose();
    this.progComp?.dispose();
    this.progBody = new GLProgram(this.gl, BODY_VS, BODY_FS(octaves), 'body');
    this.progComp = new GLProgram(this.gl, QUAD_VS, COMPOSITE_FS(octaves), 'composite');
    this.builtOctaves = octaves;
  }

  configure(settings: RenderSettings) {
    const resizeNeeded = settings.renderScale !== this.settings.renderScale || settings.dprCap !== this.settings.dprCap || settings.bloomLevels !== this.settings.bloomLevels;
    this.settings = settings;
    this.buildPrograms(settings.octaves);
    if (resizeNeeded) this.resize(this.cssW, this.cssH, this.dpr);
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    const scale = Math.min(dpr, this.settings.dprCap) * this.settings.renderScale;
    const w = Math.max(2, Math.round(cssW * scale));
    const h = Math.max(2, Math.round(cssH * scale));
    if (w === this.width && h === this.height && this.scene) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    const gl = this.gl;
    deleteTarget(gl, this.scene);
    deleteTarget(gl, this.trailA);
    deleteTarget(gl, this.trailB);
    for (const b of this.bloom) deleteTarget(gl, b);
    const make = (ww: number, hh: number) => {
      try {
        return createTarget(gl, ww, hh, this.hdr);
      } catch {
        this.hdr = false;
        return createTarget(gl, ww, hh, false);
      }
    };
    this.scene = make(w, h);
    this.trailA = make(w, h);
    this.trailB = make(w, h);
    this.bloom = [];
    let bw = w, bh = h;
    for (let i = 0; i < this.settings.bloomLevels; i++) {
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
      this.bloom.push(make(bw, bh));
    }
  }

  private fullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private bindTarget(t: RenderTarget | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, t ? t.width : this.width, t ? t.height : this.height);
  }

  private updatePalette(sim: OrganismSimulation) {
    const e = sim.expr;
    const c = this.colors;
    const b = 1;
    hsl(e.hue, e.saturation, 0.6, c, 0); // A: membrane
    hsl(e.hue - e.hueSpread, e.saturation * 0.85, 0.42, c, 3); // B: cytoplasm
    hsl(e.hue + e.hueSpread * 1.6, Math.min(1, e.saturation + 0.1), 0.68, c, 6); // C: accent
    hsl(0.07, 0.9, 0.58, c, 9); // E: ember
    hsl(e.hue + 0.5 * e.hueSpread, 0.25, 0.75, c, 12); // motes
    for (let i = 0; i < 15; i++) c[i] *= b;
  }

  private buildFilaments(sim: OrganismSimulation): number {
    const pts = sim.pts;
    const need = sim.pointCount * 2 * FIL_FLOATS;
    if (this.filData.length < need) this.filData = new Float32Array(need);
    const needIdx = sim.pointCount * 6;
    if (this.filIndex.length < needIdx) this.filIndex = new Uint16Array(needIdx);
    const data = this.filData, idx = this.filIndex;
    let v = 0, ii = 0, vert = 0;
    const e = sim.expr;
    const glowScale = 3.4;
    const shape = sim.shape;
    for (const f of sim.filaments) {
      if (f.growth < 0.01) continue;
      const n = f.segs;
      // Depth: 0 far behind, 1 in front.
      const front = f.depthNow * 0.5 + 0.5;
      const tierGain = f.tier === 0 ? 1.15 : f.tier === 1 ? 0.62 : 0.55;
      const base = tierGain * (0.38 + front * 0.72) * (0.7 + e.energy * 0.4) * Math.min(1, f.growth * 1.4);
      const widthDepth = 0.6 + front * 0.55;
      const first = vert;
      for (let j = 0; j < n; j++) {
        const o = (f.offset + j) * 3;
        const x = pts[o], y = pts[o + 1];
        const a = (f.offset + Math.max(0, j - 1)) * 3;
        const c = (f.offset + Math.min(n - 1, j + 1)) * 3;
        let tx = pts[c] - pts[a], ty = pts[c + 1] - pts[a + 1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        const u = j / (n - 1);
        // Tapers from a thick root to a hair-fine tip.
        const taper = Math.pow(1 - u, f.tier === 0 ? 0.8 : 1.1) * 0.9 + 0.1;
        const width = f.width * taper * (0.55 + f.growth * 0.45) * widthDepth * glowScale;
        const sig = OrganismSimulation.signalAt(f, u);
        let intensity = base * (1 - u * u * u * 0.85) * (0.55 + 0.45 * Math.min(1, u * 8)) + sig * (f.tier === 0 ? 1.9 : 1.3);
        // Behind the body: seen through the translucent membrane, so dimmed.
        if (f.depthNow < -0.05) {
          const dx = x - sim.cx, dy = y - sim.cy;
          const r = shape.radiusAt(Math.atan2(dy, dx));
          const inside = 1 - Math.min(1, Math.max(0, (Math.hypot(dx, dy) - r * 0.85) / (r * 0.2)));
          intensity *= 1 - inside * Math.min(1, -f.depthNow * 1.6) * 0.75;
        }
        const hue = clamp(0.5 + f.hueOffset * 0.35 + u * 0.4);
        const nx = -ty * width, ny = tx * width;
        data[v++] = x + nx; data[v++] = y + ny; data[v++] = -1; data[v++] = u; data[v++] = intensity; data[v++] = hue;
        data[v++] = x - nx; data[v++] = y - ny; data[v++] = 1; data[v++] = u; data[v++] = intensity; data[v++] = hue;
        vert += 2;
      }
      for (let j = 0; j < n - 1; j++) {
        const q = first + j * 2;
        idx[ii++] = q; idx[ii++] = q + 1; idx[ii++] = q + 2;
        idx[ii++] = q + 1; idx[ii++] = q + 3; idx[ii++] = q + 2;
      }
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.filVbo);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, v), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.filIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx.subarray(0, ii), gl.DYNAMIC_DRAW);
    return ii;
  }

  render(sim: OrganismSimulation, frame: FrameInfo) {
    if (this.lost || !this.scene || !this.trailA || !this.trailB) return;
    const gl = this.gl;
    const e = sim.expr;
    const viewX = sim.viewX, viewY = sim.viewY;
    this.updatePalette(sim);
    const c = this.colors;
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const r = sim.ripples[i];
      this.ripples[i * 4] = r.x;
      this.ripples[i * 4 + 1] = r.y;
      this.ripples[i * 4 + 2] = r.age;
      this.ripples[i * 4 + 3] = r.active ? r.strength * (frame.reducedMotion ? 0.4 : 1) : 0;
    }

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);

    // 1. Trails: previous trail faded, then fresh particles.
    const trailsOn = this.settings.trails && !frame.reducedMotion;
    this.bindTarget(this.trailB);
    gl.disable(gl.BLEND);
    this.progFade.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailA.tex);
    gl.uniform1i(this.progFade.u('uTex'), 0);
    gl.uniform1f(this.progFade.u('uDecay'), trailsOn ? 0.86 : 0);
    this.fullscreen();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    if (sim.particleCount > 0) {
      this.progPart.use();
      gl.uniform2f(this.progPart.u('uView'), viewX, viewY);
      gl.uniform1f(this.progPart.u('uPixel'), (2 * viewY) / this.height);
      gl.uniform3fv(this.progPart.u('uColA'), c.subarray(0, 3));
      gl.uniform3fv(this.progPart.u('uColC'), c.subarray(6, 9));
      gl.uniform3fv(this.progPart.u('uMote'), c.subarray(12, 15));
      gl.uniform1f(this.progPart.u('uBright'), trailsOn ? 0.55 : 1);
      gl.bindVertexArray(this.partVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.partVbo);
      gl.bufferData(gl.ARRAY_BUFFER, sim.particleOut.subarray(0, sim.particleCount * PARTICLE_STRIDE), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sim.particleCount);
    }
    const tmp = this.trailA;
    this.trailA = this.trailB;
    this.trailB = tmp;

    // 2. Scene.
    this.bindTarget(this.scene);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendFunc(gl.ONE, gl.ONE);

    // Filaments first (behind and around the membrane, additive so order is irrelevant).
    const indexCount = this.buildFilaments(sim);
    if (indexCount > 0) {
      this.progFil.use();
      gl.uniform2f(this.progFil.u('uView'), viewX, viewY);
      gl.uniform3fv(this.progFil.u('uColA'), c.subarray(0, 3));
      gl.uniform3fv(this.progFil.u('uColC'), c.subarray(6, 9));
      gl.uniform1f(this.progFil.u('uBright'), e.brightness * 0.9);
      gl.bindVertexArray(this.filVao);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
    }

    // Body.
    const s = sim.shape;
    let ampSum = 0;
    for (let k = 0; k < HARMONICS; k++) {
      this.amp[k] = s.amp[k];
      this.phase[k] = s.phase[k];
      ampSum += s.amp[k];
    }
    const pb = this.progBody;
    pb.use();
    gl.uniform2f(pb.u('uCenter'), sim.cx, sim.cy);
    gl.uniform1f(pb.u('uExtent'), s.radius * (1 + ampSum + s.polyStrength * 0.3) * 2.1);
    gl.uniform2f(pb.u('uView'), viewX, viewY);
    gl.uniform1f(pb.u('uRadius'), s.radius);
    gl.uniform1fv(pb.u('uAmp'), this.amp);
    gl.uniform1fv(pb.u('uPhase'), this.phase);
    gl.uniform3f(pb.u('uPoly'), s.polySides, s.polyPhase, s.polyStrength);
    gl.uniform2f(pb.u('uDent'), s.dentAngle, s.dentStrength);
    gl.uniform1f(pb.u('uTime'), sim.time);
    gl.uniform1f(pb.u('uSpin'), e.spin);
    gl.uniform1f(pb.u('uBeat'), e.beat);
    gl.uniform1f(pb.u('uBeatPhase'), e.beatPhase);
    gl.uniform1f(pb.u('uEnergy'), e.energy);
    gl.uniform1f(pb.u('uTension'), e.tension);
    gl.uniform1f(pb.u('uOpen'), e.openness);
    gl.uniform1f(pb.u('uCrystal'), e.crystal);
    gl.uniform1f(pb.u('uSoft'), e.softness);
    gl.uniform1f(pb.u('uRings'), e.rings);
    gl.uniform1f(pb.u('uEmber'), e.ember);
    gl.uniform1f(pb.u('uVacuoles'), e.vacuoles);
    gl.uniform1f(pb.u('uHalo'), e.halo);
    gl.uniform1f(pb.u('uBright'), e.brightness);
    gl.uniform1f(pb.u('uLightAngle'), e.lightAngle);
    gl.uniform1f(pb.u('uDay'), e.daylight);
    gl.uniform1f(pb.u('uGlow'), e.glow);
    gl.uniform2f(pb.u('uNucleus'), e.nucleusX, e.nucleusY);
    gl.uniform3fv(pb.u('uColA'), c.subarray(0, 3));
    gl.uniform3fv(pb.u('uColB'), c.subarray(3, 6));
    gl.uniform3fv(pb.u('uColC'), c.subarray(6, 9));
    gl.uniform3fv(pb.u('uColE'), c.subarray(9, 12));
    gl.uniform4fv(pb.u('uRipples'), this.ripples);
    this.fullscreen();

    // Add particle trails into the scene so they bloom with everything else.
    this.progCopy.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailA.tex);
    gl.uniform1i(this.progCopy.u('uTex'), 0);
    gl.uniform1f(this.progCopy.u('uGain'), 1);
    this.fullscreen();

    // 3. Bloom chain.
    gl.disable(gl.BLEND);
    let src: RenderTarget = this.scene;
    this.progDown.use();
    gl.uniform1i(this.progDown.u('uTex'), 0);
    for (let i = 0; i < this.bloom.length; i++) {
      const dst = this.bloom[i];
      this.bindTarget(dst);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform2f(this.progDown.u('uTexel'), 1 / src.width, 1 / src.height);
      gl.uniform1f(this.progDown.u('uPrefilter'), i === 0 ? 1 : 0);
      this.fullscreen();
      src = dst;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.progUp.use();
    gl.uniform1i(this.progUp.u('uTex'), 0);
    for (let i = this.bloom.length - 1; i > 0; i--) {
      const from = this.bloom[i], to = this.bloom[i - 1];
      this.bindTarget(to);
      gl.bindTexture(gl.TEXTURE_2D, from.tex);
      gl.uniform2f(this.progUp.u('uTexel'), 1 / from.width, 1 / from.height);
      this.fullscreen();
    }
    gl.disable(gl.BLEND);

    // 4. Composite to screen.
    this.bindTarget(null);
    const pc = this.progComp;
    pc.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
    gl.uniform1i(pc.u('uScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloom.length ? this.bloom[0].tex : this.scene.tex);
    gl.uniform1i(pc.u('uBloom'), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(pc.u('uView'), viewX, viewY);
    gl.uniform2f(pc.u('uResolution'), this.width, this.height);
    gl.uniform1f(pc.u('uTime'), sim.time);
    gl.uniform1f(pc.u('uDay'), e.daylight);
    gl.uniform1f(pc.u('uTwilight'), Math.max(0, 1 - Math.abs(e.daylight - 0.5) * 2.4));
    gl.uniform1f(pc.u('uCloud'), e.cloud);
    gl.uniform1f(pc.u('uHumidity'), e.humidity);
    gl.uniform1f(pc.u('uRain'), e.rain);
    gl.uniform1f(pc.u('uFlash'), frame.reducedMotion ? 0 : e.flash);
    gl.uniform1f(pc.u('uFrost'), e.frost);
    gl.uniform1f(pc.u('uWarmth'), e.warmth);
    gl.uniform1f(pc.u('uStorm'), e.storm);
    gl.uniform1f(pc.u('uBloomGain'), (this.hdr ? 0.42 : 0.3) * e.glow);
    gl.uniform1f(pc.u('uGrain'), this.settings.grain);
    gl.uniform2f(pc.u('uFog'), frame.fogX, frame.fogY);
    gl.uniform2f(pc.u('uCenter'), sim.cx, sim.cy);
    gl.uniform1f(pc.u('uRadius'), s.radius);
    gl.uniform3fv(pc.u('uColA'), c.subarray(0, 3));
    gl.uniform4fv(pc.u('uRipples'), this.ripples);
    gl.uniform1f(pc.u('uLab'), frame.lab ? 1 : 0);
    this.fullscreen();
    gl.bindVertexArray(null);
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}
