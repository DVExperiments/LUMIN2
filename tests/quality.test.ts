import { describe, expect, it } from 'vitest';
import { QualityManager, AUTO_LADDER } from '../src/render/quality';

/**
 * Simulate a display that delivers frames at max(refresh, GPU cost of the current level).
 * Returns the level history.
 */
function run(q: QualityManager, refreshMs: number, costMs: number[], seconds: number) {
  const levels: number[] = [];
  let t = 0;
  while (t < seconds) {
    const frame = Math.max(refreshMs, costMs[q.level]) * (1 + (Math.sin(t * 13) * 0.02)); // small jitter
    q.sample(frame, frame / 1000);
    t += frame / 1000;
    if (levels[levels.length - 1] !== q.level) levels.push(q.level);
  }
  return levels;
}

describe('automatic quality', () => {
  it('climbs to the top on a fast GPU behind a 60 Hz vsync (the v2 bug)', () => {
    const q = new QualityManager('auto');
    run(q, 16.67, [5, 6, 7, 9, 12], 60);
    expect(q.level).toBe(AUTO_LADDER.length - 1);
  });

  it('settles at the highest sustainable level and does not oscillate', () => {
    const q = new QualityManager('auto');
    // Levels 3 and 4 cannot hold 60 fps on this GPU.
    const history = run(q, 16.67, [8, 10, 14, 24, 37], 300);
    expect(q.level).toBe(2);
    // Retries back off exponentially (after 1, then 2, then 4 minutes): at most three
    // probes of the too-slow level in five minutes, and never the level above it.
    expect(history.filter((l) => l === 3).length).toBeLessThanOrEqual(3);
    expect(history).not.toContain(4);
  });

  it('steps down on a slow device', () => {
    const q = new QualityManager('auto');
    run(q, 16.67, [20, 30, 45, 60, 80], 60);
    expect(q.level).toBe(0);
  });

  it('learns a 144 Hz refresh and judges against it', () => {
    const q = new QualityManager('auto');
    run(q, 6.94, [4, 5, 6, 12, 16], 120);
    expect(q.refreshMs).toBeLessThan(8);
    expect(q.level).toBe(2);
  });

  it('manual presets are never changed automatically', () => {
    const q = new QualityManager('ultra');
    run(q, 16.67, [80, 80, 80, 80, 80], 30);
    expect(q.settings.renderScale).toBe(1);
  });
});
