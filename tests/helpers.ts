import { Store } from '../src/store';

/** 空の端末（IndexedDB）を開く */
export async function freshStore(): Promise<Store> {
  const s = new Store();
  await s.open();
  return s;
}

/** n バイトの写真の代わり */
export const fakePhoto = (n: number, fill = 1) => new Blob([new Uint8Array(n).fill(fill)], { type: 'image/jpeg' });

/** テスト用の旅を1つ作る */
export async function makeTrip(store: Store, tid: string, opts: { photos?: string[] } = {}): Promise<void> {
  const p = 'trips/' + tid + '/';
  await store.write('trips/' + tid, { name: '旅' + tid, createdAt: 1 });
  await store.write(p + 'meta/trip', { start: '2027-05-01' });
  await store.write(p + 'meta/budget', { '宿泊': 1000 });
  await store.write(p + 'stops/s01', { order: 10, place: '福江', pref: '長崎', region: 7, nights: 2, kind: 'B', lodging: '知人宅', lodgingName: '友だちの家', what: '教会めぐり', memo: '鍵はポストの中', lat: 32.6961, lng: 128.8413, arrive: 'ship', booking: 'paid', cost: 5000 });
  await store.write(p + 'stops/s02', { order: 20, place: '中通島', pref: '長崎', region: 7, nights: 1, kind: 'T', lodging: '安い宿', lodgingName: '民宿なかどおり', what: '', memo: '', lat: 32.99, lng: 129.118, arrive: 'ship', booking: 'none', cost: 0 });
  await store.write(p + 'bookings/b01', { title: 'ジェットフォイル', kind: '船', stopId: 's01', date: '2027-05-01', status: 'paid', amount: 9000, memo: '予約番号 ABC123', order: 10 });
  await store.write(p + 'expenses/e01', { amount: 1200, cat: '食費', date: '2027-05-02', memo: '友だちにおごった', at: 1 });
  await store.write(p + 'wishes/p42', { pref: '長崎', code: '42', items: [{ id: 'w1', k: 'eat', n: '五島うどん', d: '' }] });
  await store.write(p + 'wishdone/w1', { done: true, at: new Date(2027, 4, 2).getTime() });
  const photos = opts.photos || [];
  for (const id of photos) await store.putPhoto(id, fakePhoto(100));
  await store.write(p + 'diary/2027-05-02', { text: '海がきれい', place: '福江', photos });
}
