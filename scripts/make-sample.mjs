// サンプルの旅（public/sample-trip.zip）を作る。中身は架空の旅で、個人の予定は入れない。
// 使い方: node scripts/make-sample.mjs
import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';

const PREFS = ['北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島', '茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川', '新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知', '三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山', '鳥取', '島根', '岡山', '広島', '山口', '徳島', '香川', '愛媛', '高知', '福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'];
const TID = 'sample-hokkaido';
const P = 'trips/' + TID + '/';
// 端末で直したデータの方が新しいとみなされるよう、更新時刻はいちばん古い値にする
const T = 1;
const records = [];
const add = (path, data) => { const parts = path.split('/'); records.push({ path, col: parts.slice(0, -1).join('/'), id: parts.at(-1), data, updatedAt: T, deleted: false }); };

add('trips/' + TID, { name: 'サンプル：北海道をめぐる旅', createdAt: T, sample: true });
add(P + 'meta/trip', { start: '2027-07-10' });
add(P + 'meta/budget', { '宿泊': 120000, '食費': 90000, '交通': 30000, 'ガソリン・高速': 40000, '観光・体験': 20000, '予備費': 30000 });

const stops = [
  ['函館', 2, 'B', '安い宿', '函館山の夜景、函館朝市、五稜郭', 41.77, 140.73, 'ship', 'booked', 16000],
  ['洞爺湖', 1, 'T', '温泉旅館', '洞爺湖、昭和新山', 42.56, 140.82, 'car', 'none', 0],
  ['小樽', 1, 'T', '安い宿', '小樽運河、寿司', 43.19, 141.0, 'car', 'none', 0],
  ['札幌', 2, 'B', '安い宿', 'すすきの、札幌ラーメン、スープカレー', 43.06, 141.35, 'car', 'none', 0],
  ['富良野', 1, 'T', '車中泊', 'ラベンダー畑、美瑛の丘', 43.34, 142.38, 'car', 'none', 0],
  ['知床', 2, 'B', '車中泊', '知床五湖、観光船', 44.07, 144.99, 'car', 'none', 0],
  ['釧路', 1, 'T', '安い宿', '釧路湿原、和商市場の勝手丼', 42.98, 144.38, 'car', 'none', 0],
  ['帯広', 1, 'T', '車中泊', '十勝の牧場、豚丼', 42.92, 143.2, 'car', 'none', 0]
];
stops.forEach(([place, nights, kind, lodging, what, lat, lng, arrive, booking, cost], i) => {
  add(P + 'stops/s' + String(i + 1).padStart(2, '0'), { order: (i + 1) * 10, place, pref: '北海道', region: 0, nights, kind, lodging, what, lat, lng, arrive, booking, cost, lodgingName: '', memo: '' });
});
add(P + 'bookings/b01', { title: 'フェリー（本州から函館へ）', kind: '船', stopId: 's01', date: '', status: 'booked', amount: 18000, memo: '予約番号をここに書いておく', order: 10 });
add(P + 'bookings/b02', { title: '知床の観光船', kind: '見学・体験', stopId: 's06', date: '', status: 'none', amount: 0, memo: '天気が悪いと出ないことがある', order: 20 });
add(P + 'expenses/e01', { amount: 2800, cat: '食費', date: '2027-07-11', memo: '函館朝市の海鮮丼', at: T, by: '' });

PREFS.forEach((pref, i) => {
  const code = String(i + 1).padStart(2, '0');
  const items = pref === '北海道' ? [
    { id: 'w01-s1', k: 'see', n: '函館の夜景', d: '函館山から見る' },
    { id: 'w01-s2', k: 'see', n: '旭山動物園', d: '' },
    { id: 'w01-s3', k: 'eat', n: 'スープカレー', d: '札幌' },
    { id: 'w01-s4', k: 'eat', n: 'ジンギスカン', d: '' }
  ] : [];
  add(P + 'wishes/p' + code, { pref, code, items });
});
add(P + 'wishdone/w01-s1', { done: true, at: T, by: '' });

const zip = new JSZip();
zip.file('data.json', JSON.stringify({ format: 'tabicho-backup', version: 1, exportedAt: '2026-11-24T00:00:00Z', records }));
zip.folder('photos');
const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
writeFileSync(new URL('../public/sample-trip.zip', import.meta.url), buf);
console.log('public/sample-trip.zip', records.length, 'records', buf.length, 'bytes');
