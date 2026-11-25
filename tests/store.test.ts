import { describe, expect, it } from 'vitest';
import { Store, scopedDb, type DocRecord } from '../src/store';
import { fakePhoto, freshStore } from './helpers';

describe('Store（端末内の保存）', () => {
  it('書いたものを読め、閉じて開き直しても残る', async () => {
    const s = await freshStore();
    await s.write('trips/t1', { name: 'A' });
    await s.write('trips/t1/stops/s1', { place: '福江' });
    const again = new Store(); await again.open();
    expect(again.read('trips/t1')).toEqual({ name: 'A' });
    expect(again.list('trips/t1/stops').map((r) => r.id)).toEqual(['s1']);
  });

  it('奇数の区切りのパスは書けない', async () => {
    const s = await freshStore();
    await expect(s.write('trips/t1/stops', { x: 1 })).rejects.toThrow();
  });

  it('消すと見えなくなるが、消した印は残る', async () => {
    const s = await freshStore();
    await s.write('trips/t1', { name: 'A' });
    await s.write('trips/t1', null);
    expect(s.read('trips/t1')).toBeUndefined();
    expect(s.list('trips')).toEqual([]);
    expect(s.allRecords().find((r) => r.path === 'trips/t1')?.deleted).toBe(true);
  });

  it('取り込みでは新しい方を残し、消したものは古いデータで生き返らない', async () => {
    const s = await freshStore();
    await s.write('trips/t1', { name: '新しい' }, 200);
    await s.write('trips/t2', null, 200);
    const rec = (path: string, data: DocRecord['data'], updatedAt: number): DocRecord => ({ path, col: 'trips', id: path.split('/')[1], data, updatedAt, deleted: data === null });
    const n = await s.merge([rec('trips/t1', { name: '古い' }, 100), rec('trips/t2', { name: '古い' }, 100), rec('trips/t3', { name: '増えた' }, 100)]);
    expect(n).toBe(1);
    expect(s.read('trips/t1')).toEqual({ name: '新しい' });
    expect(s.read('trips/t2')).toBeUndefined();
    expect(s.read('trips/t3')).toEqual({ name: '増えた' });
  });

  it('旅を消しても、ID の頭が同じ別の旅は消えない', async () => {
    const s = await freshStore();
    await s.write('trips/t1', { name: '1' }); await s.write('trips/t1/stops/a', { p: 1 });
    await s.write('trips/t10', { name: '10' }); await s.write('trips/t10/stops/a', { p: 1 });
    await s.removeTrip('t1');
    expect(s.read('trips/t1')).toBeUndefined();
    expect(s.read('trips/t1/stops/a')).toBeUndefined();
    expect(s.read('trips/t10')).toEqual({ name: '10' });
    expect(s.read('trips/t10/stops/a')).toEqual({ p: 1 });
  });

  it('どの日記にも使われていない写真だけを片付ける', async () => {
    const s = await freshStore();
    await s.putPhoto('used', fakePhoto(10)); await s.putPhoto('unused', fakePhoto(10));
    await s.write('trips/t1/diary/2027-05-01', { photos: ['used'] });
    await new Promise((ok) => setTimeout(ok, 5)); // 作ってから少し時間がたったことにする
    expect(await s.removeUnusedPhotos(0)).toBe(1);
    expect((await s.allPhotoIds()).sort()).toEqual(['used']);
  });

  it('アーティファクト版と同じ形の db で読み書きでき、update は中身を混ぜる', async () => {
    const s = await freshStore();
    const db = scopedDb(s, 'trips/t1/');
    await db.doc('meta/budget').set({ a: 1, nest: { x: 1 } });
    await db.doc('meta/budget').update({ nest: { y: 2 } });
    expect((await db.doc('meta/budget').get()).data()).toEqual({ a: 1, nest: { x: 1, y: 2 } });
    const ref = await db.collection('expenses').add({ amount: 100 });
    const got = await new Promise<number>((ok) => { db.collection('expenses').onSnapshot((q) => ok(q.size)); });
    expect(got).toBe(1);
    await ref.delete();
    expect((await ref.get()).exists).toBe(false);
  });
});
