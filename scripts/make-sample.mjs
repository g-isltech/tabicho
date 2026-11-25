// サンプルの旅（public/sample-trip.zip）を作る。中身は架空の旅で、個人の予定は入れない。
// 使い方: node scripts/make-sample.mjs
import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';

const PREFS = ['北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島', '茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川', '新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知', '三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山', '鳥取', '島根', '岡山', '広島', '山口', '徳島', '香川', '愛媛', '高知', '福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'];
const TID = 'sample-goto';
const P = 'trips/' + TID + '/';
// 端末で直したデータの方が新しいとみなされるよう、更新時刻はいちばん古い値にする
const T = 1;
const records = [];
const add = (path, data) => { const parts = path.split('/'); records.push({ path, col: parts.slice(0, -1).join('/'), id: parts.at(-1), data, updatedAt: T, deleted: false }); };

add('trips/' + TID, { name: 'サンプル：五島列島をめぐる旅', createdAt: T, sample: true });
add(P + 'meta/trip', { start: '2027-05-01' });
add(P + 'meta/budget', { '宿泊': 70000, '食費': 45000, '交通': 50000, 'ガソリン・高速': 10000, '観光・体験': 15000, '予備費': 20000 });

// [場所, 泊数, 種類, 泊まり方, やること, 緯度, 経度, 着き方, 予約, 宿代]
const stops = [
  ['長崎', 1, 'T', '安い宿', '出島、ちゃんぽん。翌朝の船に乗る', 32.745, 129.873, 'car', 'booked', 6000],
  ['福江', 2, 'B', 'ホテル', '石田城跡、武家屋敷通り、鬼岳', 32.696, 128.841, 'ship', 'booked', 16000],
  ['玉之浦', 1, 'T', 'テント泊', '大瀬埼灯台の夕日、井持浦教会', 32.651, 128.659, 'car', 'none', 0],
  ['岐宿', 1, 'T', '車中泊', '水ノ浦教会、魚津ヶ崎公園', 32.786, 128.772, 'car', 'none', 0],
  ['奈留島', 1, 'T', '安い宿', '江上天主堂、宮の浜', 32.835, 128.937, 'ship', 'none', 0],
  ['中通島', 2, 'B', '安い宿', '頭ヶ島天主堂、五島うどんの地獄炊き、蛤浜', 32.990, 129.118, 'ship', 'none', 0],
  ['佐世保', 1, 'T', 'ホテル', '九十九島、佐世保バーガー', 33.160, 129.722, 'ship', 'none', 0]
];
stops.forEach(([place, nights, kind, lodging, what, lat, lng, arrive, booking, cost], i) => {
  add(P + 'stops/s' + String(i + 1).padStart(2, '0'), { order: (i + 1) * 10, place, pref: '長崎', region: 7, nights, kind, lodging, what, lat, lng, arrive, booking, cost, lodgingName: '', memo: '' });
});
add(P + 'bookings/b01', { title: 'ジェットフォイル（長崎から福江へ）', kind: '船', stopId: 's02', date: '', status: 'booked', amount: 9000, memo: '予約番号をここに書いておく', order: 10 });
add(P + 'bookings/b02', { title: 'レンタカー（福江島）', kind: 'レンタカー', stopId: 's02', date: '', status: 'none', amount: 0, memo: '島の中は車があると便利', order: 20 });
add(P + 'bookings/b03', { title: 'フェリー（中通島から佐世保へ）', kind: '船', stopId: 's07', date: '', status: 'none', amount: 0, memo: '海が荒れると欠航することがある', order: 30 });
add(P + 'expenses/e01', { amount: 9000, cat: '交通', date: '2027-04-10', memo: 'ジェットフォイルの前払い', at: T, by: '' });

PREFS.forEach((pref, i) => {
  const code = String(i + 1).padStart(2, '0');
  const items = pref === '長崎' ? [
    { id: 'w42-s1', k: 'see', n: '大瀬埼灯台の夕日', d: '福江島の西の端' },
    { id: 'w42-s2', k: 'see', n: '頭ヶ島天主堂', d: '石造りの教会' },
    { id: 'w42-s3', k: 'see', n: '高浜海水浴場', d: '' },
    { id: 'w42-s4', k: 'eat', n: '五島うどんの地獄炊き', d: '中通島' },
    { id: 'w42-s5', k: 'eat', n: 'きびなごの刺身', d: '' }
  ] : [];
  add(P + 'wishes/p' + code, { pref, code, items });
});
add(P + 'wishdone/w42-s4', { done: true, at: T, by: '' });

const zip = new JSZip();
zip.file('data.json', JSON.stringify({ format: 'tabicho-backup', version: 1, exportedAt: '2026-11-24T00:00:00Z', records }));
zip.folder('photos');
const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
writeFileSync(new URL('../public/sample-trip.zip', import.meta.url), buf);
console.log('public/sample-trip.zip', records.length, 'records', buf.length, 'bytes');
