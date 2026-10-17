/**
 * Behaviour engine.
 *
 * Eight coupled internal variables evolve continuously. Each has a target
 * shaped by immediate conditions, the short/medium memory, morphology,
 * temperament (genome), interaction history and the *other* variables, and
 * approaches it with its own (sometimes asymmetric) time constant. A seeded
 * Ornstein–Uhlenbeck process gives each variable its own restless life, so the
 * organism keeps changing state even when nothing outside changes.
 *
 * Comfort is measured against what the organism is *used to* (the deep
 * exposure average), so two organisms with different histories react
 * differently to the same weather.
 */
import { approach, clamp, sigmoid, smoothstep } from '../core/math';
import { mulberry32 } from '../core/random';
import type { Exposure } from '../memory/environment';
import type { Features } from '../memory/features';
import type { Morphology } from '../organism/adaptation';
import type { Genome } from '../organism/genome';
import type { MoodSnapshot } from '../organism/state';

export type BehaviourKey = keyof MoodSnapshot;
export const BEHAVIOUR_KEYS: BehaviourKey[] = [
  'energy', 'curiosity', 'openness', 'cohesion', 'tension', 'stability', 'comfort', 'sensitivity',
];

export interface Stimulus {
  /** 0..1 how close the pointer is to the body (1 = touching). */
  proximity: number;
  /** Pointer speed in world units per second. */
  speed: number;
  /** Accumulated impulse from taps/clicks since the last update (0..∞). */
  impulse: number;
  /** Whether a pointer is present at all. */
  present: boolean;
}

export interface BehaviourInputs {
  env: Features;
  exposure: Exposure;
  morph: Morphology;
  genome: Genome;
  familiarity: number;
  wariness: number;
  stimulus: Stimulus;
  /** Seconds since the last user interaction. */
  idleSeconds: number;
}

export type Mode = 'resting' | 'drifting' | 'exploring' | 'blooming' | 'bracing' | 'sheltering' | 'recoiling' | 'attending';

export const MODE_LABEL: Record<Mode, string> = {
  resting: 'Resting',
  drifting: 'Drifting',
  exploring: 'Exploring',
  blooming: 'Blooming',
  bracing: 'Bracing against the wind',
  sheltering: 'Sheltering from rain',
  recoiling: 'Recoiling',
  attending: 'Attending to you',
};

export class BehaviourEngine {
  state: MoodSnapshot;
  /** Fast disturbance level (0..1), the immediate startle. */
  arousal = 0;
  /** Short-term habituation to touch (0..1). Repeated touches dull the response. */
  habituation = 0;
  mode: Mode = 'drifting';
  /** Smoothed boredom, rises during long inactivity and drives exploration. */
  boredom = 0;
  private noise: Record<BehaviourKey, number>;
  private rnd: () => number;

  constructor(genome: Genome, restored: MoodSnapshot | null) {
    this.rnd = mulberry32(genome.seed ^ 0x51ed270b);
    this.state = restored
      ? { ...restored }
      : { energy: 0.5, curiosity: genome.curiosity, openness: 0.5, cohesion: 0.5, tension: 0.2, stability: 0.6, comfort: 0.6, sensitivity: 0.5 };
    this.noise = { energy: 0, curiosity: 0, openness: 0, cohesion: 0, tension: 0, stability: 0, comfort: 0, sensitivity: 0 };
  }

  private gauss(): number {
    // Box–Muller from the seeded generator.
    const u = Math.max(1e-9, this.rnd());
    const v = this.rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Comfort (0..1): closeness of current conditions to what this organism is acclimatised to. */
  static comfortOf(env: Features, ex: Exposure, genome: Genome): number {
    const D = ex.deep;
    const prefWarmth = D.warmth * 0.7 + genome.warmthPreference * 0.3;
    const dWarm = Math.abs(env.warmth - prefWarmth) * 2.4;
    const dWind = Math.max(0, env.wind - D.wind - 0.1) * 1.6;
    const dRain = Math.max(0, env.rain - D.rain - 0.05) * 1.2;
    const dHum = Math.abs(env.humidity - D.humidity) * 0.6;
    const storm = env.storm * 0.8;
    return clamp(1 - Math.sqrt(dWarm * dWarm + dWind * dWind + dRain * dRain + dHum * dHum) - storm);
  }

  update(dt: number, inp: BehaviourInputs): void {
    const s = this.state;
    const { env, exposure: ex, morph, genome, stimulus: st } = inp;

    // Intrinsic restlessness: OU noise with ~8 s correlation, amplitude shaped by stability.
    const noiseAmp = 0.05 + 0.06 * (1 - s.stability);
    for (const k of BEHAVIOUR_KEYS) {
      this.noise[k] += (-this.noise[k] / 8) * dt + noiseAmp * Math.sqrt(dt / 4) * this.gauss();
    }
    const n = this.noise;

    // --- Interaction ---------------------------------------------------------
    const fastness = smoothstep(0.6, 2.6, st.speed);
    const startle = st.impulse * (1 - this.habituation * 0.75) * (0.5 + s.sensitivity);
    const nearFast = st.proximity * fastness * (0.5 + genome.skittishness);
    this.arousal = clamp(this.arousal + startle * 0.55 + nearFast * dt * 2.2);
    this.arousal = approach(this.arousal, 0, dt, 2.2 + morph.resilience * 2);
    this.habituation = clamp(this.habituation + st.impulse * 0.18);
    this.habituation = approach(this.habituation, 0, dt, 40);
    const gentle = st.present ? st.proximity * (1 - fastness) : 0;
    this.boredom = approach(this.boredom, smoothstep(8, 60, inp.idleSeconds), dt, 6);

    // --- Comfort ---------------------------------------------------------------
    const comfortTarget = BehaviourEngine.comfortOf(env, ex, genome);
    s.comfort = clamp(approach(s.comfort, comfortTarget + n.comfort * 0.5, dt, 20));

    // --- Energy: light, warmth near preference, gentle wind; recent days matter too.
    const recentLight = ex.short.light * 0.4 + env.light * 0.6;
    const thermal = 1 - Math.abs(env.warmth - (genome.warmthPreference + 0.08)) * 1.6;
    const energyTarget =
      0.18 + 0.32 * recentLight + 0.22 * clamp(thermal) + 0.14 * smoothstep(0.1, 0.5, env.wind) -
      0.12 * env.cloud * env.light + 0.1 * (ex.medium.light - 0.4) + 0.18 * this.arousal + 0.12 * s.comfort -
      0.1 * env.frost + n.energy;
    s.energy = clamp(approach(s.energy, energyTarget, dt, 9));

    // --- Tension: wind turbulence, rain, startle, discomfort; rises fast, falls slow.
    const tensionTarget =
      0.06 + 0.32 * smoothstep(0.35, 0.9, env.wind) + 0.18 * env.rain + 0.45 * env.storm +
      0.55 * this.arousal + 0.25 * (1 - s.comfort) + 0.25 * inp.wariness - 0.15 * morph.resilience + n.tension;
    s.tension = clamp(approach(s.tension, tensionTarget, dt, tensionTarget > s.tension ? 1.4 : 9));

    // --- Openness: blooms when energetic, comfortable and lit; closes with tension and cold.
    const opennessTarget =
      0.22 + 0.36 * s.energy + 0.3 * s.comfort + 0.12 * env.light - 0.5 * s.tension - 0.25 * env.frost +
      0.12 * morph.expanse + 0.12 * gentle * inp.familiarity + n.openness;
    s.openness = clamp(approach(s.openness, opennessTarget, dt, 6));

    // --- Cohesion: holds together under cold, tension and crystalline structure.
    const cohesionTarget =
      0.35 + 0.25 * (1 - env.warmth) + 0.32 * s.tension + 0.22 * morph.crystal - 0.22 * s.openness + n.cohesion;
    s.cohesion = clamp(approach(s.cohesion, cohesionTarget, dt, 5));

    // --- Curiosity: temperament + comfort + familiarity; boredom pushes exploration.
    const curiosityTarget =
      genome.curiosity * 0.55 + 0.22 * s.comfort + 0.28 * inp.familiarity + 0.25 * this.boredom +
      0.2 * gentle - 0.45 * s.tension - 0.15 * (1 - s.energy) + n.curiosity;
    s.curiosity = clamp(approach(s.curiosity, curiosityTarget, dt, 10));

    // --- Stability: calm, predictable weather and resilience.
    const stabilityTarget =
      0.75 - 0.4 * ex.medium.wind * (1 - morph.resilience * 0.5) - 0.35 * ex.volatility - 0.35 * this.arousal +
      0.15 * morph.resilience - 0.2 * env.storm + n.stability;
    s.stability = clamp(approach(s.stability, stabilityTarget, dt, 15));

    // --- Sensitivity: temperament, habituation, familiarity, recent restlessness.
    const sensitivityTarget =
      0.3 + 0.45 * genome.skittishness - 0.4 * this.habituation - 0.25 * inp.familiarity + 0.3 * inp.wariness +
      0.2 * ex.medium.storm + n.sensitivity * 0.5;
    s.sensitivity = clamp(approach(s.sensitivity, sensitivityTarget, dt, 12));

    this.mode = this.classify(env, gentle);
  }

  /** Soft classification into a describable mode (for the Observatory and narration). */
  private classify(env: Features, gentle: number): Mode {
    const s = this.state;
    const scores: [Mode, number][] = [
      ['recoiling', this.arousal * 1.6],
      ['attending', gentle * (0.6 + s.curiosity)],
      ['bracing', sigmoid(env.wind, 0.6, 10) * (0.5 + s.tension) + env.storm],
      ['sheltering', sigmoid(env.rain, 0.35, 10) * (0.6 + s.cohesion * 0.6)],
      ['blooming', s.openness * s.energy * 1.5],
      ['exploring', s.curiosity * this.boredom * 1.4 + s.curiosity * s.energy * 0.4],
      ['resting', (1 - s.energy) * (1 - s.tension) * 1.1],
      ['drifting', 0.42],
    ];
    let best = scores[0];
    for (const sc of scores) if (sc[1] > best[1]) best = sc;
    return best[0];
  }

  snapshot(): MoodSnapshot {
    return { ...this.state };
  }
}
