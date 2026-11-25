import { describe, expect, it } from 'vitest';
import { buildPart, exportZip, importZip, planExport } from '../src/backup';
import { fakePhoto, freshStore, makeTrip } from './helpers';
import JSZip from 'jszip';
import { IDBFactory } from 'fake-indexeddb';

/** 別の端末に見立てて、空の IndexedDB に切り替える */
const otherDevice = () => { globalThis.indexedDB = new IDBFactory(); return freshStore(); };

describe('書き出しと読み込み', () => {
  it('すべて書き出して、別の端末で読み込むと同じになる', async () => {
    const a = await freshStore();
    await makeTrip(a, 't1', { photos: ['p1', 'p2'] });
    await makeTrip(a, 't2');
    await a.write('trips/t2/stops/s02', null); // 消した印も運ぶ
    const zip = await exportZip(a);

    const b = await otherDevice();
    const r = await importZip(b, zip);
    expect(r.photos).toBe(2);
    expect(r.tripIds.sort()).toEqual(['t1', 't2']);
    expect(b.read('trips/t1/stops/s01')).toEqual(a.read('trips/t1/stops/s01'));
    expect(b.read('trips/t2/stops/s02')).toBeUndefined();
    expect((await b.getPhoto('p1'))?.size).toBe(100);
  });

  it('旅を1つだけ書き出すと、その旅とその写真だけが入る', async () => {
    const a = await freshStore();
    await makeTrip(a, 't1', { photos: ['p1'] });
    await makeTrip(a, 't2', { photos: ['p2'] });
    const zip = await JSZip.loadAsync(await exportZip(a, 't1'));
    const data = JSON.parse(await zip.file('data.json')!.async('string'));
    expect(data.records.every((r: { path: string }) => r.path === 'trips/t1' || r.path.startsWith('trips/t1/'))).toBe(true);
    expect(Object.keys(zip.files).filter((f) => f.endsWith('.jpg'))).toEqual(['photos/p1.jpg']);
  });

  it('上限を超えると写真だけのファイルに分かれ、どの順に読み込んでもそろう', async () => {
    const a = await freshStore();
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
    await makeTrip(a, 't1');
    for (const id of ids) await a.putPhoto(id, fakePhoto(1000));
    await a.write('trips/t1/diary/2027-05-03', { text: '', photos: ids });
    const plan = await planExport(a, undefined, true, 2500);
    expect(plan.parts.length).toBeGreaterThan(1);
    expect(plan.parts.flatMap((p) => p.photoIds).sort()).toEqual(ids);
    plan.parts.forEach((p, i) => { if (i > 0) expect(p.bytes).toBeLessThanOrEqual(2500); });
    const blobs = [];
    for (let i = 0; i < plan.parts.length; i++) blobs.push(await buildPart(a, plan, i));

    const b = await otherDevice();
    for (const blob of blobs.reverse()) await importZip(b, blob); // 写真のファイルを先に読んでもよい
    expect((await b.allPhotoIds()).sort()).toEqual(ids);
    expect(b.read('trips/t1/diary/2027-05-03')).toEqual({ text: '', photos: ids });
  });

  it('データだけの書き出しには写真が入らない', async () => {
    const a = await freshStore();
    await makeTrip(a, 't1', { photos: ['p1'] });
    const plan = await planExport(a, undefined, false);
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0].photoIds).toEqual([]);
    const zip = await JSZip.loadAsync(await buildPart(a, plan, 0));
    expect(Object.keys(zip.files).some((f) => f.endsWith('.jpg'))).toBe(false);
  });

  it('たび帳のファイルでなければ読み込まない', async () => {
    const s = await freshStore();
    const z = new JSZip(); z.file('data.json', JSON.stringify({ format: 'other', records: [] }));
    await expect(importZip(s, await z.generateAsync({ type: 'blob' }))).rejects.toThrow('たび帳の書き出しファイルではありません');
    const empty = new JSZip(); empty.file('readme.txt', 'x');
    await expect(importZip(s, await empty.generateAsync({ type: 'blob' }))).rejects.toThrow();
  });

  it('おかしな名前の写真は読み込まない', async () => {
    const s = await freshStore();
    const z = new JSZip();
    z.file('data.json', JSON.stringify({ format: 'tabicho-backup', version: 1, records: [] }));
    z.file('photos/ok_1.jpg', 'x'); z.file('photos/bad name.jpg', 'x');
    const r = await importZip(s, await z.generateAsync({ type: 'blob' }));
    expect(r.photos).toBe(1);
    expect(await s.allPhotoIds()).toEqual(['ok_1']);
  });
});
