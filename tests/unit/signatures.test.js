import { describe, it, expect } from 'vitest';
import { computeStatus } from '../../src/signatures/status.js';
import { smoothStroke } from '../../src/signatures/sigImage.js';

describe('signing status', () => {
  it('partially signed counts as in progress', () => {
    expect(computeStatus([{ status: 'signed' }, { status: 'waiting' }], 'sent')).toBe('viewed');
  });
  it('all signers signed', () => {
    expect(computeStatus([{ status: 'signed' }, { status: 'signed' }], 'viewed')).toBe('signed');
  });
  it('any decline declines the request', () => {
    expect(computeStatus([{ status: 'declined' }, { status: 'sent' }], 'viewed')).toBe('declined');
  });
});

describe('signature stroke smoothing', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  // A sine-shaped stroke with ~3px hand jitter, sampled every 8ms.
  const raw = Array.from({ length: 120 }, (_, i) => ({ x: i * 3 + rnd() * 6, y: 80 + Math.sin(i / 12) * 30 + rnd() * 6, t: i * 8, p: 0 }));
  const roughness = (pts) => {
    let s = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const ax = pts[i][0] - pts[i - 1][0], ay = pts[i][1] - pts[i - 1][1];
      const bx = pts[i + 1][0] - pts[i][0], by = pts[i + 1][1] - pts[i][1];
      s += Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    }
    return s / (pts.length - 2);
  };
  const out = smoothStroke(raw);

  it('removes most of the jitter (average turn angle drops 3x or more)', () => {
    expect(roughness(out)).toBeLessThan(roughness(raw.map((p) => [p.x, p.y])) / 3);
  });
  it('keeps the start and end points', () => {
    expect(Math.abs(out[0][0] - raw[0].x)).toBeLessThan(0.01);
    expect(Math.abs(out.at(-1)[0] - raw.at(-1).x)).toBeLessThan(0.01);
  });
  it('gives every point a sensible positive width', () => {
    const widths = out.map((p) => p[2]);
    expect(Math.min(...widths)).toBeGreaterThan(0);
    expect(Math.max(...widths)).toBeLessThan(10);
  });
  it('handles a single tap and an empty stroke', () => {
    const tap = smoothStroke([{ x: 5, y: 5, t: 0, p: 0 }]);
    expect(tap.length).toBeGreaterThanOrEqual(1);
    expect(tap[0][0]).toBeCloseTo(5);
    expect(smoothStroke([])).toEqual([]);
  });
});
