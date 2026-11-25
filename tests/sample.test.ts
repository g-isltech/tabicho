import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { importZip } from '../src/backup';
import { FULL, routeBox } from '../src/geo';
import { freshStore } from './helpers';

describe('サンプルの旅', () => {
  it('読み込めて、五島列島の旅になっている', async () => {
    const s = await freshStore();
    const buf = readFileSync(new URL('../public/sample-trip.zip', import.meta.url));
    const r = await importZip(s, new Blob([buf]));
    expect(r.tripIds).toEqual(['sample-goto']);
    const trip = s.read('trips/sample-goto')!;
    expect(trip.sample).toBe(true);
    const stops = s.list('trips/sample-goto/stops').map((x) => x.data!);
    expect(stops.length).toBeGreaterThan(3);
    expect(stops.every((x) => x.pref === '長崎' && typeof x.lat === 'number' && typeof x.lng === 'number')).toBe(true);
    expect(stops.map((x) => x.place)).toContain('福江');
    // 地図はルートに合わせると、五島のあたりに寄る
    const box = routeBox(stops as { lat: number; lng: number }[]);
    expect(box.w).toBeLessThan(FULL.w / 5);
    // 都道府県ごとのやりたいことが47そろっている
    expect(s.list('trips/sample-goto/wishes')).toHaveLength(47);
  });
});
