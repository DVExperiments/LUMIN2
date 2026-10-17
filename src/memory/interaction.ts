/**
 * Interaction memory: the organism's own history with the person observing it.
 * Kept strictly separate from environmental memory (and from ancestral climate).
 */
import { clamp } from '../core/math';
import { DAY } from './environment';

export interface InteractionMemory {
  firstMet: number;
  lastSeen: number;
  sessions: number;
  /** Total seconds a pointer spent gently near the organism. */
  gentleSeconds: number;
  touches: number;
  /** Sharp, fast or repeated disturbances. */
  disturbances: number;
  /** 0..1, grows slowly with gentle company, fades slowly with long absence. */
  familiarity: number;
  /** 0..1, residue of recent rough handling; fades over hours of wall-clock time. */
  wariness: number;
  /** Seconds observed in total (page visible). */
  observedSeconds: number;
}

export function createInteractionMemory(now: number): InteractionMemory {
  return {
    firstMet: now,
    lastSeen: now,
    sessions: 0,
    gentleSeconds: 0,
    touches: 0,
    disturbances: 0,
    familiarity: 0,
    wariness: 0,
    observedSeconds: 0,
  };
}

/**
 * Apply the passage of real time since the last visit. This models forgetting,
 * not weather: nothing is invented about the environment.
 */
export function beginSession(m: InteractionMemory, now: number): { awayMs: number } {
  const awayMs = Math.max(0, now - m.lastSeen);
  const awayDays = awayMs / DAY;
  m.familiarity *= Math.exp(-awayDays / 60); // half-life ≈ 6 weeks
  m.wariness *= Math.exp(-awayMs / (6 * 3600000));
  m.sessions++;
  m.lastSeen = now;
  return { awayMs };
}

export function recordGentle(m: InteractionMemory, seconds: number) {
  m.gentleSeconds += seconds;
  // Diminishing returns: the first hour of company matters most.
  m.familiarity = clamp(m.familiarity + seconds * 0.0009 * (1 - m.familiarity) * (1 - m.wariness * 0.7));
}

export function recordTouch(m: InteractionMemory, roughness: number) {
  m.touches++;
  if (roughness > 0.6) {
    m.disturbances++;
    m.wariness = clamp(m.wariness + 0.05 * roughness);
  } else {
    m.familiarity = clamp(m.familiarity + 0.004 * (1 - m.familiarity));
  }
}

export function tickInteraction(m: InteractionMemory, dt: number, now: number) {
  m.observedSeconds += dt;
  m.wariness *= Math.exp(-dt / (2 * 3600));
  m.lastSeen = now;
}
