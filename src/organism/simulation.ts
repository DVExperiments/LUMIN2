/**
 * Physical simulation of the organism: body dynamics, filaments, particles,
 * raindrops, ripples and light signals. Pure data — rendering reads the
 * typed arrays exposed here. No allocations happen per frame.
 *
 * World space: y up, the shorter screen half-extent is 1 unit.
 */
import { TAU, angleDelta, approach, clamp, lerp, smoothstep } from '../core/math';
import { Noise3 } from '../core/noise';
import { mulberry32 } from '../core/random';
import type { Features } from '../memory/features';
import type { Marks, Morphology } from './adaptation';
import type { Genome } from './genome';
import { MembraneShape } from './shape';
import type { MoodSnapshot } from './state';

export interface SimQuality {
  tendrilSegments: number;
  ciliaSegments: number;
  maxParticles: number;
  filamentScale: number;
}

export const QUALITY_PRESETS: Record<'eco' | 'balanced' | 'ultra', SimQuality> = {
  eco: { tendrilSegments: 14, ciliaSegments: 5, maxParticles: 1400, filamentScale: 0.7 },
  balanced: { tendrilSegments: 22, ciliaSegments: 6, maxParticles: 4200, filamentScale: 1 },
  ultra: { tendrilSegments: 30, ciliaSegments: 8, maxParticles: 9000, filamentScale: 1.25 },
};

export interface PointerInput {
  x: number;
  y: number;
  vx: number;
  vy: number;
  present: boolean;
  down: boolean;
}

export interface SimContext {
  env: Features;
  mood: MoodSnapshot;
  arousal: number;
  boredom: number;
  morph: Morphology;
  marks: Marks;
  genome: Genome;
  familiarity: number;
  pointer: PointerInput;
  /** Light direction in screen space from the sun (or a moon at night). */
  lightAngle: number;
  reducedMotion: boolean;
  weatherCode: number;
}

/** Smoothed parameters that the renderer reads. */
export interface Expression {
  hue: number;
  hueSpread: number;
  saturation: number;
  brightness: number;
  glow: number;
  softness: number;
  crystal: number;
  rings: number;
  ember: number;
  vacuoles: number;
  halo: number;
  energy: number;
  tension: number;
  openness: number;
  cohesion: number;
  beat: number;
  spin: number;
  daylight: number;
  cloud: number;
  humidity: number;
  rain: number;
  windX: number;
  windY: number;
  warmth: number;
  frost: number;
  storm: number;
  flash: number;
  lightAngle: number;
  nucleusX: number;
  nucleusY: number;
}

export interface Ripple {
  x: number;
  y: number;
  age: number;
  strength: number;
  active: boolean;
}

export const MAX_RIPPLES = 12;
export const PARTICLE_STRIDE = 8;

/** Particle kinds. */
export const P_MOTE = 0, P_SPORE = 1, P_RAIN = 2, P_SPARK = 3;

interface Filament {
  /** Anchor angle on the membrane relative to body rotation. */
  anchor: number;
  /** Elevation on the 3D body (−1 back … +1 front). */
  depth: number;
  long: boolean;
  segs: number;
  segLen: number;
  /** Offset into the shared point arrays. */
  offset: number;
  phase: number;
  freq: number;
  width: number;
  hueOffset: number;
  /** Current growth (0 retracted … 1 fully grown). */
  growth: number;
  /** Activation order threshold. */
  rank: number;
  signal: number;
  signalStrength: number;
  curl: number;
}

export class OrganismSimulation {
  readonly shape = new MembraneShape();
  readonly expr: Expression;
  /** Body centre and velocity. */
  cx = 0;
  cy = 0.02;
  vx = 0;
  vy = 0;
  time = 0;

  filaments: Filament[] = [];
  /** Filament point positions (x, y, z) and previous positions for Verlet. */
  pts: Float32Array = new Float32Array(0);
  prev: Float32Array = new Float32Array(0);
  pointCount = 0;

  /** Particle state: x, y, vx, vy, life, maxLife, size, kind, hue, depth. */
  readonly P = 10;
  particles: Float32Array = new Float32Array(0);
  maxParticles = 0;
  /** Packed instance data for rendering, PARTICLE_STRIDE floats each. */
  particleOut: Float32Array = new Float32Array(0);
  particleCount = 0;

  ripples: Ripple[] = [];
  viewX = 1.6;
  viewY = 1;

  private noise: Noise3;
  private rnd: () => number;
  private beatPhase = 0;
  private lastBeat = 0;
  private wanderX = 0;
  private wanderY = 0;
  private rainAccumulator = 0;
  private sporeAccumulator = 0;
  quality: SimQuality;
  private rippleCooldown = 0;
  private flash = 0;
  private flashTimer = 4;
  private spin = 0;
  private heading = 0;

  constructor(private genome: Genome, quality: SimQuality) {
    this.noise = new Noise3(genome.seed);
    this.rnd = mulberry32(genome.seed ^ 0x2545f491);
    this.quality = quality;
    for (let i = 0; i < MAX_RIPPLES; i++) this.ripples.push({ x: 0, y: 0, age: 99, strength: 0, active: false });
    this.expr = {
      hue: genome.hue, hueSpread: genome.hueSpread, saturation: 0.7, brightness: 1, glow: 1, softness: 0.5, crystal: 0.2,
      rings: 0, ember: 0, vacuoles: 0, halo: 0, energy: 0.5, tension: 0.2, openness: 0.5, cohesion: 0.5, beat: 0, spin: 0,
      daylight: 0.5, cloud: 0.5, humidity: 0.6, rain: 0, windX: 0, windY: 0, warmth: 0.5, frost: 0, storm: 0, flash: 0,
      lightAngle: 0.8, nucleusX: 0, nucleusY: 0,
    };
    this.build(quality);
  }

  /** (Re)allocate filaments and particles for a quality level. Keeps the body state. */
  build(q: SimQuality) {
    this.quality = q;
    const g = this.genome;
    const r = mulberry32(g.seed ^ 0x68e31da4);
    const longMax = g.tendrilBase + 7;
    const ciliaMax = Math.round(g.ciliaBase * 1.7 * q.filamentScale);
    this.filaments = [];
    let offset = 0;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < longMax; i++) {
      const segs = q.tendrilSegments;
      this.filaments.push({
        anchor: (i * golden * 1.7 + r() * 0.3) % TAU,
        depth: r() * 2 - 1,
        long: true,
        segs,
        segLen: (0.028 + r() * 0.022) * g.reach * (22 / segs),
        offset,
        phase: r() * TAU,
        freq: 0.6 + r() * 0.7,
        width: 0.006 + r() * 0.006,
        hueOffset: r() * 2 - 1,
        growth: 0,
        rank: (i + r() * 0.8) / longMax,
        signal: 2,
        signalStrength: 0,
        curl: (r() * 2 - 1) * 0.9,
      });
      offset += segs;
    }
    for (let i = 0; i < ciliaMax; i++) {
      const segs = q.ciliaSegments;
      this.filaments.push({
        anchor: (i / ciliaMax) * TAU + r() * 0.05,
        depth: r() * 2 - 1,
        long: false,
        segs,
        segLen: (0.009 + r() * 0.012) * (6 / segs),
        offset,
        phase: r() * TAU,
        freq: 1.2 + r() * 1.4,
        width: 0.0022 + r() * 0.0022,
        hueOffset: r() * 2 - 1,
        growth: 0,
        rank: r(),
        signal: 2,
        signalStrength: 0,
        curl: (r() * 2 - 1) * 0.6,
      });
      offset += segs;
    }
    this.pointCount = offset;
    this.pts = new Float32Array(offset * 3);
    this.prev = new Float32Array(offset * 3);
    // Initialise all points at the body centre; they unfurl over the first second.
    for (let i = 0; i < offset; i++) {
      this.pts[i * 3] = this.prev[i * 3] = this.cx;
      this.pts[i * 3 + 1] = this.prev[i * 3 + 1] = this.cy;
    }
    this.maxParticles = q.maxParticles;
    this.particles = new Float32Array(q.maxParticles * this.P);
    this.particleOut = new Float32Array(q.maxParticles * PARTICLE_STRIDE);
    // Seed ambient motes so the first frame is already populated.
    for (let i = 0; i < q.maxParticles * 0.35; i++) this.spawnMote(i, true);
  }

  setView(viewX: number, viewY: number) {
    const changed = Math.abs(viewX - this.viewX) > 0.05 || Math.abs(viewY - this.viewY) > 0.05;
    this.viewX = viewX;
    this.viewY = viewY;
    if (changed) {
      // Re-scatter ambient motes over the new extent so none clump in the old one.
      const P = this.P;
      for (let i = 0; i < this.maxParticles; i++) {
        if (this.particles[i * P + 7] === P_MOTE && this.particles[i * P + 4] > 0) this.spawnMote(i, true);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  addRipple(x: number, y: number, strength: number) {
    let slot = this.ripples[0];
    for (const rp of this.ripples) {
      if (!rp.active) { slot = rp; break; }
      if (rp.age > slot.age) slot = rp;
    }
    slot.x = x; slot.y = y; slot.age = 0; slot.strength = strength; slot.active = true;
  }

  /** A tap or click at (x, y) with intensity 0..1. */
  disturb(x: number, y: number, intensity: number) {
    this.addRipple(x, y, 0.5 + intensity * 0.6);
    const n = Math.round(18 + intensity * 30);
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * TAU;
      const sp = 0.4 + this.rnd() * 1.3 * (0.5 + intensity);
      this.emit(P_SPARK, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + this.rnd() * 0.7, 0.6 + this.rnd(), this.rnd());
    }
    // Fire light signals through filaments near the disturbance.
    for (const f of this.filaments) {
      const i = f.offset * 3;
      const d = Math.hypot(this.pts[i] - x, this.pts[i + 1] - y);
      if (d < 0.9 && f.growth > 0.2) {
        f.signal = -d * 0.6;
        f.signalStrength = Math.max(f.signalStrength, (1 - d / 0.9) * (0.8 + intensity));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Particles
  // ---------------------------------------------------------------------------

  private freeSlot(): number {
    const P = this.P;
    // Scan from a random start to avoid always reusing the same slots.
    const n = this.maxParticles;
    const start = Math.floor(this.rnd() * n);
    for (let k = 0; k < 64; k++) {
      const i = (start + k) % n;
      if (this.particles[i * P + 4] <= 0) return i;
    }
    return -1;
  }

  private emit(kind: number, x: number, y: number, vx: number, vy: number, life: number, size: number, hue: number) {
    const i = this.freeSlot();
    if (i < 0) return;
    const p = this.particles, o = i * this.P;
    p[o] = x; p[o + 1] = y; p[o + 2] = vx; p[o + 3] = vy;
    p[o + 4] = life; p[o + 5] = life; p[o + 6] = size; p[o + 7] = kind; p[o + 8] = hue; p[o + 9] = this.rnd();
  }

  private spawnMote(i: number, anywhere: boolean) {
    const p = this.particles, o = i * this.P;
    const r = this.rnd;
    p[o] = (r() * 2 - 1) * this.viewX * 1.1;
    p[o + 1] = (r() * 2 - 1) * this.viewY * 1.1;
    p[o + 2] = 0; p[o + 3] = 0;
    const life = 6 + r() * 14;
    p[o + 4] = anywhere ? life * r() : life;
    p[o + 5] = life;
    p[o + 6] = 0.3 + r() * r() * 1.4;
    p[o + 7] = P_MOTE;
    p[o + 8] = r();
    p[o + 9] = r();
  }

  // ---------------------------------------------------------------------------
  // Main update
  // ---------------------------------------------------------------------------

  update(rawDt: number, ctx: SimContext) {
    const dt = Math.min(rawDt, 1 / 20);
    const timeScale = ctx.reducedMotion ? 0.45 : 1;
    const sdt = dt * timeScale;
    this.time += sdt;
    const t = this.time;
    const { env, mood, morph, marks, genome, pointer } = ctx;
    const e = this.expr;

    // --- Expression: smooth everything the renderer sees ---------------------
    const tauE = 2.5;
    e.energy = approach(e.energy, mood.energy, dt, 1.2);
    e.tension = approach(e.tension, mood.tension, dt, 0.6);
    e.openness = approach(e.openness, mood.openness, dt, 1.5);
    e.cohesion = approach(e.cohesion, mood.cohesion, dt, 1.5);
    e.daylight = approach(e.daylight, env.light, dt, tauE);
    e.cloud = approach(e.cloud, env.cloud, dt, tauE);
    e.humidity = approach(e.humidity, env.humidity, dt, tauE);
    e.rain = approach(e.rain, env.rain, dt, tauE);
    e.windX = approach(e.windX, env.windX, dt, tauE);
    e.windY = approach(e.windY, env.windY, dt, tauE);
    e.warmth = approach(e.warmth, env.warmth, dt, tauE);
    e.frost = approach(e.frost, env.frost, dt, tauE);
    e.storm = approach(e.storm, env.storm, dt, tauE);
    e.lightAngle += angleDelta(e.lightAngle, ctx.lightAngle) * (1 - Math.exp(-dt / 4));
    e.crystal = approach(e.crystal, clamp(morph.crystal * 0.85 + marks.facets * 0.35 + env.frost * 0.25), dt, 3);
    e.softness = approach(e.softness, clamp(morph.softness * 0.6 + env.humidity * 0.35 + env.rain * 0.15), dt, 3);
    e.rings = approach(e.rings, marks.rings, dt, 3);
    e.ember = approach(e.ember, clamp(marks.ember + env.heat * 0.4), dt, 3);
    e.vacuoles = approach(e.vacuoles, marks.vacuoles, dt, 3);
    e.halo = approach(e.halo, marks.halo, dt, 3);
    // Colour: genome hue, slow acquired drift, and a gentle immediate temperature tint.
    const hueTarget = genome.hue + morph.hueDrift * 0.075 + (env.warmth - 0.5) * 0.04 - env.rain * 0.02;
    e.hue += angleDelta(e.hue * TAU, hueTarget * TAU) / TAU * (1 - Math.exp(-dt / 4));
    e.hueSpread = approach(e.hueSpread, genome.hueSpread * (0.7 + mood.openness * 0.6), dt, 3);
    e.saturation = approach(e.saturation, clamp(0.55 + mood.energy * 0.25 - env.cloud * 0.1 + mood.comfort * 0.1), dt, 3);
    const lum = 0.55 + morph.luminance * 0.5 + mood.energy * 0.35 - env.cloud * env.light * 0.15 + ctx.arousal * 0.4;
    e.brightness = approach(e.brightness, Math.min(1.3, lum), dt, 1.5);
    e.glow = approach(e.glow, Math.min(1.35, 0.7 + env.humidity * 0.35 + morph.softness * 0.2 + mood.openness * 0.15), dt, 3);

    // --- Heartbeat: quick contraction, slow release ----------------------------
    const beatRate = (1 / genome.pulsePeriod) * (0.55 + mood.energy * 0.9 + ctx.arousal * 0.8) * timeScale;
    this.beatPhase += dt * beatRate;
    const ph = this.beatPhase % 1;
    const beat = ph < 0.18 ? smoothstep(0, 0.18, ph) : Math.exp(-(ph - 0.18) * 5.5);
    e.beat = beat;
    const beatIndex = Math.floor(this.beatPhase);
    const newBeat = beatIndex !== this.lastBeat;
    this.lastBeat = beatIndex;

    // --- Body motion -------------------------------------------------------------
    const windStrength = Math.hypot(e.windX, e.windY);
    const mass = 0.8 + morph.expanse * 0.6;
    // Wandering target: slow noise, wider when curious or bored.
    const roam = (0.18 + mood.curiosity * 0.22 + ctx.boredom * 0.3) * (ctx.reducedMotion ? 0.5 : 1);
    this.wanderX = this.noise.noise(t * 0.035, 3.1, 0) * roam * this.viewX * 0.55;
    this.wanderY = this.noise.noise(5.7, t * 0.03, 0) * roam * 0.5 - 0.02;
    let ax = (this.wanderX - this.cx) * 0.55;
    let ay = (this.wanderY - this.cy) * 0.55;
    // Wind pushes the body downstream, resisted by cohesion and mass.
    ax += e.windX * 0.12 * (1 - mood.cohesion * 0.5);
    ay += e.windY * 0.12 * (1 - mood.cohesion * 0.5);
    // Gusts.
    const gust = this.noise.noise(t * 0.6, 11.3, 2) * windStrength;
    ax += e.windX * gust * 0.25;
    ay += e.windY * gust * 0.25;
    // Pointer: curiosity draws it near slow pointers; tension and speed push it away.
    let proximity = 0;
    if (pointer.present) {
      const dx = pointer.x - this.cx, dy = pointer.y - this.cy;
      const d = Math.hypot(dx, dy) + 1e-4;
      proximity = clamp(1 - (d - this.shape.radius) / 0.7);
      const speed = Math.hypot(pointer.vx, pointer.vy);
      const attract = (mood.curiosity * 0.6 + ctx.familiarity * 0.5) * (1 - smoothstep(0.4, 2, speed)) - mood.tension * 0.5;
      const repel = smoothstep(0.5, 2.5, speed) * proximity * (0.5 + mood.sensitivity);
      const k = (attract * 0.35 * smoothstep(1.4, 0.25, d) - repel * 1.6) / d;
      ax += dx * k;
      ay += dy * k;
      if (d < this.shape.radius * 1.1) {
        ax -= (dx / d) * 2.5;
        ay -= (dy / d) * 2.5;
      }
    }
    // Pulse propulsion: each contraction gives a small thrust along the heading.
    const desiredHeading = Math.atan2(this.wanderY - this.cy + this.vy, this.wanderX - this.cx + this.vx);
    this.heading += angleDelta(this.heading, desiredHeading) * (1 - Math.exp(-dt / 2));
    const thrust = (ph < 0.2 ? 1 : 0) * 0.35 * (0.3 + mood.energy);
    ax += Math.cos(this.heading) * thrust;
    ay += Math.sin(this.heading) * thrust;
    // Soft walls.
    const wx = this.viewX * 0.72, wy = this.viewY * 0.62;
    if (Math.abs(this.cx) > wx) ax -= Math.sign(this.cx) * (Math.abs(this.cx) - wx) * 6;
    if (Math.abs(this.cy) > wy) ay -= Math.sign(this.cy) * (Math.abs(this.cy) - wy) * 6;
    this.vx += (ax / mass) * sdt;
    this.vy += (ay / mass) * sdt;
    const drag = Math.exp(-sdt * (1.5 + mood.cohesion));
    this.vx *= drag;
    this.vy *= drag;
    this.cx += this.vx * sdt;
    this.cy += this.vy * sdt;

    // --- Membrane shape ----------------------------------------------------------
    const s = this.shape;
    const breath = 1 + Math.sin(t * 0.7 * (0.6 + mood.energy)) * 0.025;
    const targetRadius = (0.19 + morph.expanse * 0.09 + mood.openness * 0.03) * breath * (1 - beat * 0.07 * (0.6 + mood.energy));
    s.radius = approach(s.radius, targetRadius, dt, 0.25);
    s.reset();
    const lobeAmp = 0.05 + mood.openness * 0.09 - mood.cohesion * 0.04 + ctx.arousal * 0.03;
    for (let k = 2; k <= 6; k++) {
      const w = genome.lobeWeights[k - 1] * (k === genome.symmetry ? 1.6 : 0.6) / Math.sqrt(k - 1);
      const live = 0.6 + 0.4 * this.noise.noise(t * 0.12 * k, k * 7.1, 0.5);
      s.addHarmonic(k, Math.max(0, lobeAmp * w * live), genome.lobePhases[k - 1] + t * 0.05 * genome.chirality * (k % 2 ? 1 : -1));
    }
    // Tension shivers in the high harmonics.
    s.addHarmonic(7, e.tension * 0.018 * (0.6 + 0.4 * Math.sin(t * 9)), t * 2.1);
    s.addHarmonic(8, e.tension * 0.012, -t * 2.7 + genome.lobePhases[7]);
    // Acquired streamlining along the remembered wind axis, plus current wind.
    const axisAngle = Math.atan2(morph.axisY, morph.axisX);
    const axisConf = clamp(Math.hypot(morph.axisX, morph.axisY) * 2.2);
    const elong = morph.elongation * (0.35 + 0.65 * axisConf);
    s.addHarmonic(2, elong * 0.2, 2 * axisAngle);
    s.addHarmonic(1, elong * 0.06, axisAngle);
    const windAngle = Math.atan2(e.windY, e.windX);
    s.addHarmonic(2, windStrength * 0.045 * (1 - mood.cohesion * 0.5), 2 * windAngle);
    // Inertia: squash and stretch along velocity.
    const speed = Math.hypot(this.vx, this.vy);
    s.addHarmonic(2, Math.min(0.08, speed * 0.25), 2 * Math.atan2(this.vy, this.vx));
    // Crystalline faceting.
    s.polySides = genome.symmetry + 1 + Math.round(marks.facets * 2);
    s.polyPhase = genome.lobePhases[0] + this.spin * 0.25;
    s.polyStrength = e.crystal * 0.55;
    // Pointer indentation.
    if (pointer.present) {
      const dx = pointer.x - this.cx, dy = pointer.y - this.cy;
      const d = Math.hypot(dx, dy);
      const press = smoothstep(s.radius * 1.6, s.radius * 0.9, d) * (0.3 + mood.sensitivity * 0.5);
      s.dentAngle = Math.atan2(dy, dx);
      s.dentStrength = approach(s.dentStrength, press * 0.22, dt, 0.15);
    } else {
      s.dentStrength = approach(s.dentStrength, 0, dt, 0.4);
    }

    this.spin += sdt * genome.chirality * (0.03 + mood.energy * 0.06);
    e.spin = this.spin;
    // The nucleus lags behind the body like a heavy core, giving weight.
    e.nucleusX = approach(e.nucleusX, -this.vx * 0.18, dt, 0.5);
    e.nucleusY = approach(e.nucleusY, -this.vy * 0.18, dt, 0.5);

    // --- Lightning (storms only, never with reduced motion) -------------------------
    if (ctx.weatherCode >= 95 && !ctx.reducedMotion) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flash = 0.6 + this.rnd() * 0.6;
        this.flashTimer = 5 + this.rnd() * 14;
      }
    }
    this.flash = approach(this.flash, 0, dt, 0.12);
    e.flash = this.flash;

    // --- Ripples -------------------------------------------------------------------
    for (const rp of this.ripples) {
      if (!rp.active) continue;
      rp.age += sdt;
      if (rp.age > 3.2) rp.active = false;
    }
    this.rippleCooldown -= dt;

    // Fixed sub-steps keep the Verlet chains stable and smooth at any frame rate.
    const steps = Math.min(4, Math.max(1, Math.ceil(dt / (1 / 110))));
    for (let i = 0; i < steps; i++) {
      this.updateFilaments(dt / steps, sdt / steps, ctx, beat, newBeat && i === 0, proximity);
    }
    this.updateParticles(dt, sdt, ctx);
  }

  private updateFilaments(dt: number, sdt: number, ctx: SimContext, beat: number, newBeat: boolean, proximity: number) {
    const { mood, morph, pointer } = ctx;
    const e = this.expr;
    const s = this.shape;
    const pts = this.pts, prev = this.prev;
    const t = this.time;
    const windX = e.windX, windY = e.windY;
    const windStrength = Math.hypot(windX, windY);
    const downstream = windStrength > 0.02 ? Math.atan2(windY, windX) : Math.atan2(morph.axisY, morph.axisX);
    const acquiredStream = morph.elongation * clamp(Math.hypot(morph.axisX, morph.axisY) * 2.2);
    const longActive = clamp((0.55 + morph.filament * 0.6) * (0.75 + mood.openness * 0.35));
    const ciliaActive = clamp((0.35 + morph.density * 0.75) * (0.7 + mood.openness * 0.4));
    const stiffBase = 5 + mood.cohesion * 9 + e.crystal * 14 - mood.openness * 2;
    const waveAmp = (0.25 + mood.energy * 0.45) * (1 - e.crystal * 0.55) * (ctx.reducedMotion ? 0.5 : 1);
    const lengthScale = 0.65 + morph.filament * 0.75 + mood.openness * 0.25 - e.crystal * 0.15;
    const damping = Math.exp(-dt * (2.2 + mood.cohesion * 1.5));
    const px = pointer.x, py = pointer.y;
    const pSpeed = Math.hypot(pointer.vx, pointer.vy);
    const reachToward = pointer.present ? (mood.curiosity * 0.7 + ctx.familiarity * 0.6 - mood.tension) * (1 - smoothstep(0.5, 2, pSpeed)) : 0;
    const flee = pointer.present ? smoothstep(0.6, 2.6, pSpeed) * (0.4 + mood.sensitivity) : 0;
    const signalSpeed = 0.5 + mood.energy * 0.8;

    for (const f of this.filaments) {
      const activeFrac = f.long ? longActive : ciliaActive;
      const want = f.rank < activeFrac ? 1 : 0;
      f.growth = approach(f.growth, want, dt, f.long ? 2.5 : 1.2);
      if (f.growth < 0.002 && want === 0) continue;

      // Anchor on the membrane, rotating with the body.
      const theta = f.anchor + this.spin;
      const ring = s.radiusAt(theta) * (0.96 - Math.abs(f.depth) * 0.06);
      const rx = this.cx + Math.cos(theta) * ring;
      const ry = this.cy + Math.sin(theta) * ring;
      // Rest direction: outward normal, bent downstream by wind and acquired streamlining.
      const stream = clamp((f.long ? 0.85 : 0.35) * (windStrength * 1.2 + acquiredStream * 0.8));
      const baseDir = theta + angleDelta(theta, downstream) * stream;
      const segLen = f.segLen * f.growth * (f.long ? lengthScale : 0.8 + mood.openness * 0.4 - e.crystal * 0.2);
      const stiff = (f.long ? stiffBase : stiffBase * 2.2) * (0.6 + 0.4 * f.growth);

      const o0 = f.offset * 3;
      pts[o0] = rx; pts[o0 + 1] = ry; pts[o0 + 2] = f.depth;
      prev[o0] = rx; prev[o0 + 1] = ry; prev[o0 + 2] = f.depth;

      let restX = rx, restY = ry;
      let dir = baseDir;
      const n = f.segs;
      // Swimming wave travels from root to tip; the heartbeat adds a whip.
      f.phase += sdt * f.freq * (0.6 + mood.energy * 1.4) * TAU * 0.25;
      for (let j = 1; j < n; j++) {
        const u = j / (n - 1);
        const wave = Math.sin(f.phase - j * 0.42) * waveAmp * (f.long ? 0.35 : 0.5) * u;
        const curl = f.curl * (0.18 + mood.openness * 0.25) * u * (1 - e.crystal * 0.7);
        dir += (wave + curl) / n * 2.2 + (beat * 0.3 * (f.long ? 1 : 0.4)) / n * Math.sin(f.phase);
        restX += Math.cos(dir) * segLen;
        restY += Math.sin(dir) * segLen;

        const o = (f.offset + j) * 3;
        const x = pts[o], y = pts[o + 1];
        let vx = (x - prev[o]) * damping;
        let vy = (y - prev[o + 1]) * damping;
        let fx = (restX - x) * stiff * (1.2 - u * 0.6);
        let fy = (restY - y) * stiff * (1.2 - u * 0.6);
        // Wind with turbulence, stronger at the tips.
        // Low spatial frequency and coherent along each filament, so it sways rather than jitters.
        const turb = this.noise.noise(x * 0.9 + t * 0.35, y * 0.9, t * 0.25 + f.depth + u * 0.6);
        const turb2 = this.noise.noise(x * 0.9 + 17, y * 0.9 - t * 0.35, t * 0.25 + 9 + u * 0.6);
        const wgain = (f.long ? 2.2 : 1.2) * u;
        fx += (windX * (1 + turb * 0.6) + turb * windStrength * 0.45) * wgain;
        fy += (windY * (1 + turb2 * 0.6) + turb2 * windStrength * 0.45) * wgain;
        // Idle turbulence keeps filaments alive even in still air.
        fx += turb * 0.35 * u * (0.4 + mood.energy);
        fy += turb2 * 0.35 * u * (0.4 + mood.energy);
        // Pointer: reach toward slow, gentle presence; recoil from fast movement.
        if (pointer.present) {
          const dx = px - x, dy = py - y;
          const d2 = dx * dx + dy * dy + 0.002;
          const d = Math.sqrt(d2);
          if (d < 0.75) {
            const fall = 1 - d / 0.75;
            const k = (reachToward * 1.8 * fall * u - flee * 6 * fall * fall) / d;
            fx += dx * k;
            fy += dy * k;
          }
        }
        // Ripple wavefronts push outward.
        for (const rp of this.ripples) {
          if (!rp.active) continue;
          const dx = x - rp.x, dy = y - rp.y;
          const d = Math.sqrt(dx * dx + dy * dy) + 1e-4;
          const front = rp.age * 0.9;
          const band = Math.exp(-((d - front) * (d - front)) / 0.004);
          const k = band * rp.strength * 9 * Math.exp(-rp.age * 1.2) / d;
          fx += dx * k;
          fy += dy * k;
        }
        prev[o] = x; prev[o + 1] = y;
        pts[o] = x + vx + fx * sdt * sdt;
        pts[o + 1] = y + vy + fy * sdt * sdt;
        pts[o + 2] = f.depth * (1 - u * 0.5) + Math.sin(f.phase * 0.5 - j * 0.2) * 0.25 * u;
      }
      // Distance constraints, root pinned.
      for (let iter = 0; iter < 2; iter++) {
        for (let j = 1; j < n; j++) {
          const a = (f.offset + j - 1) * 3, b = (f.offset + j) * 3;
          const dx = pts[b] - pts[a], dy = pts[b + 1] - pts[a + 1];
          const d = Math.sqrt(dx * dx + dy * dy) + 1e-6;
          const diff = (d - segLen) / d;
          if (j === 1) {
            pts[b] -= dx * diff;
            pts[b + 1] -= dy * diff;
          } else {
            pts[a] += dx * diff * 0.5; pts[a + 1] += dy * diff * 0.5;
            pts[b] -= dx * diff * 0.5; pts[b + 1] -= dy * diff * 0.5;
          }
        }
      }
      // Bending stiffness: relax interior points toward their neighbours' midpoint.
      const bend = f.long ? 0.28 + e.crystal * 0.2 : 0.18;
      for (let j = 1; j < n - 1; j++) {
        const a = (f.offset + j - 1) * 3, b = (f.offset + j) * 3, c = (f.offset + j + 1) * 3;
        pts[b] += ((pts[a] + pts[c]) * 0.5 - pts[b]) * bend;
        pts[b + 1] += ((pts[a + 1] + pts[c + 1]) * 0.5 - pts[b + 1]) * bend;
      }
      // Light signals: born on heartbeats, carried outward.
      if (newBeat && this.rnd() < (f.long ? 0.35 + mood.energy * 0.4 : 0.05)) {
        f.signal = 0;
        f.signalStrength = 0.5 + mood.energy * 0.6 + proximity * 0.4;
      }
      if (f.signal < 1.4) f.signal += sdt * signalSpeed * (f.long ? 0.6 : 1.8);
      else f.signalStrength = approach(f.signalStrength, 0, dt, 0.5);
    }
  }

  private updateParticles(dt: number, sdt: number, ctx: SimContext) {
    const { mood, morph } = ctx;
    const e = this.expr;
    const p = this.particles, P = this.P, out = this.particleOut;
    const t = this.time;
    const s = this.shape;
    const windX = e.windX, windY = e.windY;
    const max = this.maxParticles;
    const flowSpeed = (0.05 + mood.energy * 0.08) * (ctx.reducedMotion ? 0.5 : 1);

    // Rain: spawn rate follows precipitation intensity.
    if (e.rain > 0.02) {
      this.rainAccumulator += dt * e.rain * 140 * (max / 4200 + 0.3);
      while (this.rainAccumulator > 1) {
        this.rainAccumulator--;
        const x = (this.rnd() * 2.4 - 1.2) * this.viewX - windX * 0.6;
        const fall = -(1.6 + e.rain * 1.4) * (ctx.reducedMotion ? 0.5 : 1);
        this.emit(P_RAIN, x, this.viewY * 1.08, windX * 1.1, fall, 3, 0.6 + this.rnd() * 0.6, this.rnd());
      }
    }
    // Spores drift from filament tips, more when open and energetic.
    this.sporeAccumulator += dt * (4 + mood.openness * 14 + mood.energy * 8) * (0.4 + morph.density);
    while (this.sporeAccumulator > 1) {
      this.sporeAccumulator--;
      const f = this.filaments[Math.floor(this.rnd() * this.filaments.length)];
      if (f.growth < 0.3) continue;
      const o = (f.offset + f.segs - 1) * 3;
      const x = this.pts[o], y = this.pts[o + 1];
      const vx = (x - this.prev[o]) / Math.max(dt, 1e-3) * 0.25;
      const vy = (y - this.prev[o + 1]) / Math.max(dt, 1e-3) * 0.25;
      this.emit(P_SPORE, x, y, vx, vy, 2 + this.rnd() * 3, 0.5 + this.rnd() * 0.8, f.hueOffset * 0.5 + 0.5);
    }

    let count = 0;
    let motes = 0;
    for (let i = 0; i < max; i++) {
      const o = i * P;
      let life = p[o + 4];
      const kind = p[o + 7];
      if (life <= 0) {
        // Keep the ambient field topped up.
        if (motes < max * 0.35 && this.rnd() < 0.02) {
          this.spawnMote(i, false);
          life = p[o + 4];
        } else continue;
      }
      let x = p[o], y = p[o + 1], vx = p[o + 2], vy = p[o + 3];
      const depth = p[o + 9];
      life -= dt;
      const dx = x - this.cx, dy = y - this.cy;
      const dist = Math.sqrt(dx * dx + dy * dy) + 1e-5;
      if (kind === P_RAIN) {
        // Raindrops striking the membrane make ripples and splashes.
        const theta = Math.atan2(dy, dx);
        if (dist < s.radiusAt(theta) * 1.02) {
          if (this.rippleCooldown <= 0) {
            this.addRipple(x, y, 0.18 + e.rain * 0.25);
            this.rippleCooldown = 0.18 / (0.3 + e.rain);
          }
          for (let k = 0; k < 2; k++) {
            this.emit(P_SPARK, x, y, (this.rnd() - 0.5) * 0.8, 0.3 + this.rnd() * 0.5, 0.35 + this.rnd() * 0.3, 0.5, this.rnd());
          }
          life = 0;
        }
        if (y < -this.viewY * 1.1) life = 0;
      } else {
        // Curl-noise flow field: divergence-free, so motes swirl instead of clumping.
        const sc = 1.3;
        const eps = 0.05;
        const n1 = this.noise.noise(x * sc, (y + eps) * sc, t * 0.06);
        const n2 = this.noise.noise(x * sc, (y - eps) * sc, t * 0.06);
        const n3 = this.noise.noise((x + eps) * sc, y * sc, t * 0.06);
        const n4 = this.noise.noise((x - eps) * sc, y * sc, t * 0.06);
        const cxf = (n1 - n2) / (2 * eps);
        const cyf = -(n3 - n4) / (2 * eps);
        const depthFactor = 0.4 + depth * 0.8;
        let tx = cxf * flowSpeed * 0.12 + windX * 0.35 * depthFactor;
        let ty = cyf * flowSpeed * 0.12 + windY * 0.35 * depthFactor;
        if (kind === P_MOTE) {
          // Gentle orbit and, when open, a slow inhalation of nearby light.
          const near = smoothstep(0.9, 0.2, dist);
          const swirl = near * 0.08 * this.genome.chirality;
          tx += (-dy / dist) * swirl - (dx / dist) * near * mood.openness * 0.05;
          ty += (dx / dist) * swirl - (dy / dist) * near * mood.openness * 0.05;
          if (dist < s.radius * 0.95) life = Math.min(life, 0.3);
          motes++;
        } else if (kind === P_SPORE) {
          tx += (dx / dist) * 0.05;
          ty += (dy / dist) * 0.05 + 0.01;
        }
        // Ripple pushes.
        for (const rp of this.ripples) {
          if (!rp.active) continue;
          const rx = x - rp.x, ry = y - rp.y;
          const d = Math.sqrt(rx * rx + ry * ry) + 1e-4;
          const band = Math.exp(-((d - rp.age * 0.9) ** 2) / 0.01) * rp.strength * Math.exp(-rp.age);
          tx += (rx / d) * band * 0.6;
          ty += (ry / d) * band * 0.6;
        }
        // Pointer wake.
        const pt = ctx.pointer;
        if (pt.present) {
          const qx = x - pt.x, qy = y - pt.y;
          const d2 = qx * qx + qy * qy;
          if (d2 < 0.06) {
            const k = (1 - d2 / 0.06) * 0.6;
            tx += pt.vx * k * 0.5;
            ty += pt.vy * k * 0.5;
          }
        }
        const resp = kind === P_SPARK ? 0.6 : 2.5;
        vx = lerp(vx, tx, 1 - Math.exp(-dt * resp));
        vy = lerp(vy, ty, 1 - Math.exp(-dt * resp));
        if (kind === P_MOTE) {
          if (x > this.viewX * 1.15) x -= this.viewX * 2.3;
          if (x < -this.viewX * 1.15) x += this.viewX * 2.3;
          if (y > this.viewY * 1.15) y -= this.viewY * 2.3;
          if (y < -this.viewY * 1.15) y += this.viewY * 2.3;
        }
      }
      x += vx * sdt;
      y += vy * sdt;
      p[o] = x; p[o + 1] = y; p[o + 2] = vx; p[o + 3] = vy; p[o + 4] = life;
      if (life <= 0) continue;

      const maxLife = p[o + 5];
      const age = 1 - life / maxLife;
      let alpha: number;
      if (kind === P_MOTE) alpha = Math.sin(Math.PI * age) * (0.12 + depth * 0.38);
      else if (kind === P_RAIN) alpha = 0.35 + e.daylight * 0.15;
      else if (kind === P_SPORE) alpha = Math.sin(Math.PI * Math.min(1, age * 1.4)) * 0.9;
      else alpha = (1 - age) * (1 - age);
      const w = count * PARTICLE_STRIDE;
      out[w] = x; out[w + 1] = y; out[w + 2] = vx; out[w + 3] = vy;
      out[w + 4] = p[o + 6] * (kind === P_MOTE ? 0.22 + depth * 0.4 : kind === P_SPORE ? 0.7 : 1);
      out[w + 5] = alpha;
      out[w + 6] = p[o + 8];
      out[w + 7] = kind;
      count++;
    }
    this.particleCount = count;
  }

  /** Signal intensity at position u (0..1) along a filament. */
  static signalAt(f: { signal: number; signalStrength: number }, u: number): number {
    const d = u - f.signal;
    return f.signalStrength * Math.exp(-d * d * 90);
  }
}
