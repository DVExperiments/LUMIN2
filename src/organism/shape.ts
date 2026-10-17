/**
 * The membrane silhouette as a polar function r(θ).
 *
 * The exact same function is evaluated in TypeScript (to anchor filaments and
 * detect raindrop impacts) and in GLSL (to draw the membrane), so the
 * organism stays coherent however much it deforms.
 *
 *   r(θ) = R · (1 + Σₖ aₖ cos(kθ − φₖ)) · polygon(θ)^crystal − dent(θ)
 */
import { TAU, angleDelta } from '../core/math';

export const HARMONICS = 8;

export class MembraneShape {
  /** World-space radius. */
  radius = 0.24;
  /** Harmonic amplitude/phase pairs, k = 1..HARMONICS. */
  readonly amp = new Float32Array(HARMONICS);
  readonly phase = new Float32Array(HARMONICS);
  /** Crystalline faceting: polygon side count, rotation and strength (0..1). */
  polySides = 5;
  polyPhase = 0;
  polyStrength = 0;
  /** Local indentation where something presses on the membrane. */
  dentAngle = 0;
  dentStrength = 0;

  /** Unit-radius multiplier at angle θ (no dent). */
  shapeFactor(theta: number): number {
    let r = 1;
    for (let k = 0; k < HARMONICS; k++) r += this.amp[k] * Math.cos((k + 1) * theta - this.phase[k]);
    if (this.polyStrength > 0) {
      const seg = TAU / this.polySides;
      let a = (theta - this.polyPhase) % seg;
      if (a < 0) a += seg;
      const poly = Math.cos(Math.PI / this.polySides) / Math.cos(a - seg / 2);
      r *= 1 + (poly - 1) * this.polyStrength;
    }
    return r;
  }

  radiusAt(theta: number): number {
    let r = this.radius * this.shapeFactor(theta);
    if (this.dentStrength > 0) {
      const d = angleDelta(theta, this.dentAngle);
      r -= this.radius * this.dentStrength * Math.exp(-(d * d) / 0.18);
    }
    return Math.max(this.radius * 0.35, r);
  }

  /** Add a harmonic contribution as a vector (amplitude a at phase φ) to harmonic k (1-based). */
  addHarmonic(k: number, a: number, phi: number) {
    const i = k - 1;
    const x = this.amp[i] * Math.cos(this.phase[i]) + a * Math.cos(phi);
    const y = this.amp[i] * Math.sin(this.phase[i]) + a * Math.sin(phi);
    this.amp[i] = Math.hypot(x, y);
    this.phase[i] = Math.atan2(y, x);
  }

  reset() {
    this.amp.fill(0);
    this.phase.fill(0);
  }
}
