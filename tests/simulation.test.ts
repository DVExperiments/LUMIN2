import { describe, expect, it } from 'vitest';
import { OrganismSimulation, QUALITY_PRESETS } from '../src/organism/simulation';
import { createGenome } from '../src/organism/genome';
import { neutralMorphology, emptyMarks } from '../src/organism/adaptation';
import { rawToFeatures } from '../src/memory/features';
import { MembraneShape } from '../src/organism/shape';

function run(seconds: number, dt: number, windKmh: number, rain: number) {
  const g = createGenome(31);
  const sim = new OrganismSimulation(g, QUALITY_PRESETS.balanced);
  sim.setView(1.6, 1);
  const env = rawToFeatures(5, windKmh, 270, rain, 90, 90, 0.5, 95);
  const mood = { energy: 0.8, curiosity: 0.5, openness: 0.6, cohesion: 0.4, tension: 0.7, stability: 0.3, comfort: 0.3, sensitivity: 0.6 };
  for (let t = 0; t < seconds; t += dt) {
    sim.update(dt, {
      env, mood, arousal: 0.5, boredom: 0.2, morph: { ...neutralMorphology(), elongation: 0.8, axisX: 0.6 },
      marks: emptyMarks(), genome: g, familiarity: 0.3,
      pointer: { x: Math.sin(t) * 0.4, y: 0.1, vx: Math.cos(t) * 2, vy: 0, present: true, down: false },
      lightAngle: 1, reducedMotion: false, weatherCode: 95,
    });
    if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) sim.disturb(0.1, 0.1, 0.8);
  }
  return sim;
}

describe('organism simulation', () => {
  for (const [label, dt] of [['60 fps', 1 / 60], ['slow 12 fps', 1 / 12]] as const) {
    it(`stays finite and coherent in a gale with rain at ${label}`, () => {
      const sim = run(12, dt, 90, 6);
      for (let i = 0; i < sim.pointCount * 3; i++) expect(Number.isFinite(sim.pts[i])).toBe(true);
      // Filaments stay attached and inextensible: every tip within reach of the body.
      for (const f of sim.filaments) {
        const tip = (f.offset + f.segs - 1) * 3;
        const d = Math.hypot(sim.pts[tip] - sim.cx, sim.pts[tip + 1] - sim.cy);
        // Physical limit: rim (shape factor up to ~2) plus the chain at its maximum length scale
        // (1.15 for long filaments, 1.2 for cilia), allowing up to 10% Verlet stretch in a gale.
        const maxChain = f.segLen * f.lengthFactor * 1.2 * (f.segs - 1) * 1.1;
        expect(d).toBeLessThan(sim.shape.radius * 2 + maxChain);
        // No single segment may be badly overstretched (that would render as a kink).
        let sum = 0, longest = 0;
        for (let j = 1; j < f.segs; j++) {
          const a = (f.offset + j - 1) * 3, b = (f.offset + j) * 3;
          const l = Math.hypot(sim.pts[b] - sim.pts[a], sim.pts[b + 1] - sim.pts[a + 1]);
          sum += l;
          longest = Math.max(longest, l);
        }
        if (f.growth > 0.5) expect(longest / (sum / (f.segs - 1))).toBeLessThan(1.35);
        // No kinks: every joint stays within the bend limit (plus constraint slack).
        for (let j = 2; j < f.segs; j++) {
          const a0 = (f.offset + j - 2) * 3, a1 = (f.offset + j - 1) * 3, a2 = (f.offset + j) * 3;
          const p1 = Math.atan2(sim.pts[a1 + 1] - sim.pts[a0 + 1], sim.pts[a1] - sim.pts[a0]);
          const p2 = Math.atan2(sim.pts[a2 + 1] - sim.pts[a1 + 1], sim.pts[a2] - sim.pts[a1]);
          let d = Math.abs(p2 - p1) % (2 * Math.PI);
          if (d > Math.PI) d = 2 * Math.PI - d;
          if (f.growth > 0.5) expect(d, `joint ${j}`).toBeLessThan(0.5 + 0.05);
        }
      }
      expect(sim.particleCount + sim.moteCount).toBeGreaterThan(100);
      expect(sim.moteCount).toBeGreaterThan(50);
      expect(Number.isFinite(sim.cx) && Number.isFinite(sim.cy)).toBe(true);
      expect(Math.abs(sim.cx)).toBeLessThan(2);
    });
  }

  it('the membrane function is periodic and bounded', () => {
    const s = new MembraneShape();
    s.addHarmonic(3, 0.2, 1);
    s.addHarmonic(2, 0.3, 0.5);
    s.polyStrength = 0.5;
    s.polySides = 6;
    for (let a = 0; a < 7; a += 0.1) {
      expect(s.radiusAt(a)).toBeCloseTo(s.radiusAt(a + Math.PI * 2), 5);
      expect(s.radiusAt(a)).toBeGreaterThan(0);
    }
  });
});
