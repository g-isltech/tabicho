import { describe, expect, it } from 'vitest';
import { FULL, PX, PY, roundCoord, routeBox } from '../src/geo';

describe('routeBox（地図をルートに合わせる）', () => {
  it('場所がなければ日本全体', () => {
    expect(routeBox([])).toEqual(FULL);
    expect(routeBox([{ lat: undefined, lng: undefined }, { lat: 'x', lng: 1 }])).toEqual(FULL);
  });

  it('すべての場所が範囲に入り、周りに余白がある', () => {
    const pts = [{ lat: 32.745, lng: 129.873 }, { lat: 32.651, lng: 128.659 }, { lat: 33.16, lng: 129.722 }];
    const b = routeBox(pts);
    for (const p of pts) {
      expect(PX(p.lng)).toBeGreaterThan(b.x);
      expect(PX(p.lng)).toBeLessThan(b.x + b.w);
      expect(PY(p.lat)).toBeGreaterThan(b.y);
      expect(PY(p.lat)).toBeLessThan(b.y + b.h);
    }
    expect(b.w).toBeLessThan(FULL.w / 5); // 日本全体よりずっと狭い
  });

  it('場所が1つでも、寄りすぎない', () => {
    const b = routeBox([{ lat: 32.7, lng: 128.8 }]);
    expect(b.w).toBe(120);
    expect(b.h).toBe(120);
    expect(b.x + b.w / 2).toBeCloseTo(PX(128.8));
    expect(b.y + b.h / 2).toBeCloseTo(PY(32.7));
  });
});

describe('roundCoord（共有で座標を丸める）', () => {
  it('0.02度のます目にそろえる', () => {
    expect(roundCoord(32.6961)).toBe(32.7);
    expect(roundCoord(128.8413)).toBe(128.84);
    expect(roundCoord(129.118)).toBe(129.12);
  });
  it('ずれは最大でも0.01度', () => {
    for (let v = 30; v < 31; v += 0.0037) expect(Math.abs(roundCoord(v) - v)).toBeLessThanOrEqual(0.01 + 1e-9);
  });
});
