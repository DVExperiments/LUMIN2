/** Small, allocation-free math helpers shared by simulation and rendering. */

export const TAU = Math.PI * 2;

export const clamp = (x: number, lo = 0, hi = 1): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, x: number): number => clamp((x - a) / (b - a));
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = invLerp(a, b, x);
  return t * t * (3 - 2 * t);
};
/** Logistic response curve centred on `mid`; `k` controls steepness. */
export const sigmoid = (x: number, mid: number, k: number): number => 1 / (1 + Math.exp(-(x - mid) * k));

/** Frame-rate independent exponential approach. `tau` is the time constant in seconds. */
export const approach = (current: number, target: number, dt: number, tau: number): number =>
  tau <= 0 ? target : current + (target - current) * (1 - Math.exp(-dt / tau));

/** Exponential moving average weight for an elapsed interval and a time constant (same units). */
export const emaWeight = (dt: number, tau: number): number => 1 - Math.exp(-dt / tau);

/** Shortest signed angular difference in radians. */
export const angleDelta = (from: number, to: number): number => {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

export const degToRad = (d: number): number => (d * Math.PI) / 180;
