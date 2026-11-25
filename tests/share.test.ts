import { describe, expect, it } from 'vitest';
import { buildShare, DEFAULT_SHARE, shareHtml, shareZip } from '../src/share';
import { importZip } from '../src/backup';
import { freshStore, makeTrip } from './helpers';
import { IDBFactory } from 'fake-indexeddb';

const find = (records: { path: string; data: Record<string, unknown> | null }[], suffix: string) => records.find((r) => r.path.endsWith(suffix))?.data;

describe('旅の記録の共有', () => {
  it('初期設定では、宿の名前・お金・予約・メモ・本当の日付を入れない', async () => {
    const s = await freshStore();
    await makeTrip(s, 't1', { photos: ['p1'] });
    const b = buildShare(s, 't1', DEFAULT_SHARE);
    const json = JSON.stringify(b.records);
    for (const secret of ['友だちの家', '民宿なかどおり', '鍵はポストの中', '予約番号', '友だちにおごった', '2027-05']) expect(json).not.toContain(secret);
    expect(b.records.some((r) => r.col.endsWith('/bookings') || r.col.endsWith('/expenses'))).toBe(false);
    expect(find(b.records, '/meta/trip')).toEqual({ start: '2000-01-01', relative: true });
    // 日記は「何日目」にずらす（出発日 5/1 の翌日 → 2000-01-02）
    expect(b.records.some((r) => r.path.endsWith('/diary/2000-01-02'))).toBe(true);
    const trip = find(b.records, 'trips/' + b.tripId);
    expect(trip).toMatchObject({ readonly: true, shared: true, hidden: ['book', 'money'] });
    expect(b.tripId).not.toBe('t1');
    expect(b.photoIds).toEqual(['p1']);
  });

  it('宿の名前を見せないときは、座標を丸める', async () => {
    const s = await freshStore();
    await makeTrip(s, 't1');
    const hide = find(buildShare(s, 't1', DEFAULT_SHARE).records, '/stops/s01')!;
    expect(hide).toMatchObject({ lat: 32.7, lng: 128.84 });
    const show = find(buildShare(s, 't1', { ...DEFAULT_SHARE, lodgingNames: true }).records, '/stops/s01')!;
    expect(show).toMatchObject({ lat: 32.6961, lng: 128.8413, lodgingName: '友だちの家' });
  });

  it('お金を見せても、出費のメモと予約のメモは入れない', async () => {
    const s = await freshStore();
    await makeTrip(s, 't1');
    const b = buildShare(s, 't1', { ...DEFAULT_SHARE, money: true, bookings: true, realDates: true });
    expect(find(b.records, '/expenses/e01')).toEqual({ amount: 1200, cat: '食費', at: 1, date: '2027-05-02' });
    const bk = find(b.records, '/bookings/b01')!;
    expect(bk.memo).toBeUndefined();
    expect(bk.date).toBe('2027-05-01');
  });

  it('日記も写真も見せないときは、日記を入れない', async () => {
    const s = await freshStore();
    await makeTrip(s, 't1', { photos: ['p1'] });
    const b = buildShare(s, 't1', { ...DEFAULT_SHARE, diary: false, photos: false });
    expect(b.records.some((r) => r.col.endsWith('/diary'))).toBe(false);
    expect(b.photoIds).toEqual([]);
  });

  it('旅帳で開けるファイルは、受け取った側で「もらった旅」になる', async () => {
    const s = await freshStore();
    await makeTrip(s, 't1', { photos: ['p1'] });
    const b = buildShare(s, 't1', DEFAULT_SHARE);
    const zip = await shareZip(s, b);
    globalThis.indexedDB = new IDBFactory();
    const other = await freshStore();
    const r = await importZip(other, zip);
    expect(r.tripIds).toEqual([b.tripId]);
    expect(other.read('trips/' + b.tripId)?.readonly).toBe(true);
    expect(await other.allPhotoIds()).toEqual(['p1']);
  });

  it('見るだけのページは、スクリプトを入れず、文字を無害化する', async () => {
    const s = await freshStore();
    await makeTrip(s, 't1');
    await s.write('trips/t1/diary/2027-05-03', { text: '<script>alert(1)</script>', place: '<b>x</b>', photos: [] });
    const html = await (await shareHtml(s, buildShare(s, 't1', DEFAULT_SHARE), null, 'https://example.com/tabicho/')).text();
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('1日目');
    expect(html).not.toContain('友だちの家');
  });
});
