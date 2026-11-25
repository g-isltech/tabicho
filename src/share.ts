// 旅の記録を人に見せるための共有。
// 見せる項目を選んで、2つの形で書き出す。
//   1. 見るだけのページ（HTML ファイル1つ。旅帳がなくても開ける）
//   2. 旅帳で開ける zip（受け取った側では「もらった旅」として見るだけになる）
// メモ・予約番号など、共有に向かないものは選べないようにして、最初から入れない。
import JSZip from 'jszip';
import { newId, type Data, type DocRecord, type Store } from './store';

export interface ShareOptions {
  diary: boolean; // 日記の文章
  photos: boolean; // 日記の写真
  wishes: boolean; // やりたいことと達成
  realDates: boolean; // 本当の日付（false なら「1日目」形式）
  lodgingNames: boolean; // 宿・キャンプ場の名前
  money: boolean; // 予算・出費
  bookings: boolean; // 予約（メモは入れない）
}

export const DEFAULT_SHARE: ShareOptions = { diary: true, photos: true, wishes: true, realDates: false, lodgingNames: false, money: false, bookings: false };

// 日付を隠すときに使う、意味のない出発日（「1日目」の計算にだけ使う）
const DUMMY_START = '2000-01-01';

const parseD = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const iso = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const dayDiff = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);

const pick = (d: Data | null | undefined, keys: string[]): Data => { const o: Data = {}; if (d) keys.forEach((k) => { if (d[k] !== undefined) o[k] = d[k]; }); return o; };

export interface ShareBuild {
  records: DocRecord[];
  photoIds: string[];
  tripId: string;
  name: string;
}

/** 共有用のデータを作る。旅帳で開ける形（DocRecord）で返す */
export function buildShare(store: Store, tid: string, opt: ShareOptions): ShareBuild {
  const src = 'trips/' + tid + '/';
  const newTid = 's' + newId();
  const dst = 'trips/' + newTid + '/';
  const now = Date.now();
  const records: DocRecord[] = [];
  const add = (path: string, data: Data) => { const parts = path.split('/'); records.push({ path, col: parts.slice(0, -1).join('/'), id: parts[parts.length - 1], data, updatedAt: now, deleted: false }); };
  const name = String(store.read('trips/' + tid)?.name || '旅');
  const realStart = String(store.read(src + 'meta/trip')?.start || iso(new Date()));
  const start = opt.realDates ? realStart : DUMMY_START;
  const shift = (key: string) => (opt.realDates ? key : iso(new Date(parseD(DUMMY_START).getTime() + dayDiff(parseD(realStart), parseD(key)) * 86400000)));

  const hidden: string[] = [];
  if (!opt.bookings) hidden.push('book');
  if (!opt.money) hidden.push('money');
  if (!opt.wishes) hidden.push('wish');
  if (!opt.diary && !opt.photos) hidden.push('diary');
  add('trips/' + newTid, { name, createdAt: now, readonly: true, shared: true, hidden });
  add(dst + 'meta/trip', { start, relative: !opt.realDates });

  for (const r of store.list(src + 'stops')) {
    const s = r.data || {};
    const keep = ['order', 'place', 'pref', 'region', 'nights', 'kind', 'lodging', 'what', 'lat', 'lng', 'arrive'];
    if (opt.lodgingNames) keep.push('lodgingName');
    if (opt.bookings) keep.push('booking');
    if (opt.money) keep.push('cost');
    add(dst + 'stops/' + r.id, pick(s, keep));
  }
  if (opt.bookings) {
    for (const r of store.list(src + 'bookings')) {
      const b = pick(r.data, ['title', 'kind', 'stopId', 'status', 'order'].concat(opt.money ? ['amount'] : []));
      if (r.data?.date) b.date = opt.realDates ? r.data.date : '';
      add(dst + 'bookings/' + r.id, b);
    }
  }
  if (opt.money) {
    add(dst + 'meta/budget', store.read(src + 'meta/budget') || {});
    for (const r of store.list(src + 'expenses')) {
      const e = pick(r.data, ['amount', 'cat', 'memo', 'at']);
      e.date = r.data?.date ? shift(String(r.data.date)) : start;
      add(dst + 'expenses/' + r.id, e);
    }
  }
  for (const r of store.list(src + 'wishes')) {
    const w = r.data || {};
    add(dst + 'wishes/' + r.id, { pref: w.pref, code: w.code, items: opt.wishes && Array.isArray(w.items) ? w.items : [] });
  }
  if (opt.wishes) {
    for (const r of store.list(src + 'wishdone')) {
      const at = Number(r.data?.at || 0);
      // 達成した日も、日付を隠すときは「何日目」に置き換えられるよう、出発日からの差でずらす
      const atShift = opt.realDates || !at ? at : parseD(DUMMY_START).getTime() + (at - parseD(realStart).getTime());
      add(dst + 'wishdone/' + r.id, { done: true, at: atShift });
    }
  }
  const photoIds: string[] = [];
  if (opt.diary || opt.photos) {
    for (const r of store.list(src + 'diary')) {
      const d = r.data || {};
      const photos = opt.photos && Array.isArray(d.photos) ? (d.photos as string[]) : [];
      const text = opt.diary ? String(d.text || '') : '';
      if (!text.trim() && !photos.length) continue;
      photoIds.push(...photos);
      add(dst + 'diary/' + shift(r.id), { text, place: d.place || '', photos, at: now });
    }
  }
  return { records, photoIds, tripId: newTid, name };
}

/** 旅帳で開ける zip */
export async function shareZip(store: Store, b: ShareBuild): Promise<Blob> {
  const zip = new JSZip();
  zip.file('data.json', JSON.stringify({ format: 'tabicho-backup', version: 1, exportedAt: new Date().toISOString(), shared: true, records: b.records }));
  const folder = zip.folder('photos')!;
  for (const id of b.photoIds) { const blob = await store.getPhoto(id); if (blob) folder.file(id + '.jpg', blob); }
  return await zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

const toDataUrl = (blob: Blob) => new Promise<string>((ok, ng) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ng(r.error); r.readAsDataURL(blob); });

/**
 * 見るだけのページ（HTML ファイル1つ）。
 * iPhone の「ファイル」アプリや LINE のプレビューはページの中のスクリプトを動かさないので、
 * 表示する中身は、ここですべて HTML に書き出しておく（スクリプトは入れない）。
 */
export async function shareHtml(store: Store, b: ShareBuild, geo: Record<string, string> | null, appUrl: string): Promise<Blob> {
  const get = (col: string) => b.records.filter((r) => r.col === 'trips/' + b.tripId + '/' + col).map((r) => ({ id: r.id, ...(r.data || {}) }) as Data & { id: string });
  const meta = b.records.find((r) => r.path === 'trips/' + b.tripId + '/meta/trip')?.data || {};
  const photos: Record<string, string> = {};
  for (const id of b.photoIds) { const blob = await store.getPhoto(id); if (blob) photos[id] = await toDataUrl(blob); }
  const budget = b.records.find((r) => r.path === 'trips/' + b.tripId + '/meta/budget')?.data || null;
  const body = renderViewer({
    name: b.name, start: String(meta.start || DUMMY_START), relative: !!meta.relative,
    stops: get('stops').sort((x, y) => Number(x.order || 0) - Number(y.order || 0)),
    diary: get('diary'), wishes: get('wishes'), done: get('wishdone').map((d) => d.id),
    budget, expenses: get('expenses'), bookings: get('bookings'), photos, appUrl
  }, geo || {});
  const html = VIEWER.replace('__TITLE__', () => esc(b.name)).replace('__BODY__', () => body);
  return new Blob([html], { type: 'text/html' });
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

interface ViewData {
  name: string; start: string; relative: boolean;
  stops: (Data & { id: string })[]; diary: (Data & { id: string })[]; wishes: (Data & { id: string })[]; done: string[];
  budget: Data | null; expenses: (Data & { id: string })[]; bookings: (Data & { id: string })[];
  photos: Record<string, string>; appUrl: string;
}

function renderViewer(D: ViewData, G: Record<string, string>): string {
  const WD = '日月火水木金土';
  const start = parseD(D.start);
  const add = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const label = (d: Date) => (D.relative ? (dayDiff(start, d) + 1) + '日目' : (d.getMonth() + 1) + '/' + d.getDate() + '（' + WD[d.getDay()] + '）');
  let cur = start, total = 0;
  const stops = D.stops.map((s) => { const a = cur; const n = Number(s.nights) || 0; cur = add(cur, n); total += n; return { ...s, s: a, n } as Data & { id: string; s: Date; n: number }; });
  const COS = Math.cos(36 * Math.PI / 180), PX = (l: number) => (l - 122.5) * COS * 100, PY = (l: number) => (45.8 - l) * 100;
  const pts = stops.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number') as (typeof stops[number] & { lat: number; lng: number })[];
  let h = '<header><h1>' + esc(D.name) + '</h1><p class="sub">' + (stops.length ? (D.relative ? total + '泊の旅' : label(start) + '〜' + label(cur) + '・' + total + '泊') : '') + '</p></header>';
  let items = 0, dn = 0; D.wishes.forEach((p) => ((p.items as Data[]) || []).forEach((w) => { items++; if (D.done.includes(String(w.id))) dn++; }));
  if (pts.length) {
    const xs = pts.map((s) => PX(s.lng)), ys = pts.map((s) => PY(s.lat));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const w = Math.max(x1 - x0, 120), hh = Math.max(y1 - y0, 120), pad = Math.max(w, hh) * 0.12;
    const vb = [x0 - pad - (w - (x1 - x0)) / 2, y0 - pad - (hh - (y1 - y0)) / 2, w + pad * 2, hh + pad * 2];
    const u = vb[2] / 800, f = (n: number) => n.toFixed(1);
    let svg = '<svg viewBox="' + vb.map(f).join(' ') + '" role="img" aria-label="旅のルートの地図">';
    // 表示する範囲に入る県だけを描く（ファイルを小さくするため）
    Object.keys(G).forEach((k) => { if (G[k]) svg += '<path d="' + G[k] + '" fill="#FBFBF8" stroke="#D5DDE0" stroke-width="' + f(u) + '"/>'; });
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], c = pts[i], m = String(c.arrive || 'car');
      const st = m === 'ship' ? 'stroke="#1F7470" stroke-dasharray="' + f(7 * u) + ' ' + f(5 * u) + '"' : m === 'plane' ? 'stroke="#6B7378" stroke-dasharray="' + f(u) + ' ' + f(5 * u) + '" stroke-linecap="round"' : 'stroke="#1F4FA0" stroke-linecap="round"';
      svg += '<line x1="' + f(PX(a.lng)) + '" y1="' + f(PY(a.lat)) + '" x2="' + f(PX(c.lng)) + '" y2="' + f(PY(c.lat)) + '" stroke-width="' + f(3 * u) + '" ' + st + '/>';
    }
    pts.forEach((s, i) => { svg += '<circle cx="' + f(PX(s.lng)) + '" cy="' + f(PY(s.lat)) + '" r="' + f(7 * u) + '" fill="#1F4FA0" stroke="#FBFBF8" stroke-width="' + f(2 * u) + '"><title>' + esc((i + 1) + '. ' + s.place) + '</title></circle>'; });
    svg += '</svg>';
    h += '<section class="card"><div class="map">' + svg + '</div><div class="stats"><div><span class="sub">泊数</span><b>' + total + '泊</b></div><div><span class="sub">泊まった所</span><b>' + stops.length + 'か所</b></div>' +
      (items ? '<div><span class="sub">やりたいこと</span><b>' + dn + ' / ' + items + '</b></div>' : '') + '</div></section>';
  }
  h += '<section class="card"><h2>行程</h2>' + stops.map((s) => '<div class="stop"><div class="d">' + esc(label(s.s)) + '<br>' + s.n + '泊</div><div><b>' + esc(s.place) + '</b><span class="sub"> ' + esc(s.pref) + '</span>' + (s.lodging ? '<span class="pill">' + esc(s.lodging) + '</span>' : '') +
    (s.lodgingName ? '<div class="d">' + esc(s.lodgingName) + '</div>' : '') + (s.what ? '<div class="d">' + esc(s.what) + '</div>' : '') + '</div></div>').join('') + '</section>';
  const diary = D.diary.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  if (diary.length) {
    h += '<section class="card"><h2>日記</h2>' + diary.map((d) => {
      const ph = ((d.photos as string[]) || []).filter((p) => D.photos[p]);
      return '<div class="entry"><div><b>' + esc(label(parseD(d.id))) + '</b> <span class="sub">' + esc(d.place) + '</span></div>' + (d.text ? '<p>' + esc(d.text) + '</p>' : '') +
        (ph.length ? '<div class="photos">' + ph.map((p) => '<img src="' + D.photos[p] + '" alt="' + esc(label(parseD(d.id))) + 'の写真">').join('') + '</div>' : '') + '</div>';
    }).join('') + '</section>';
  }
  const doneList: string[] = [];
  D.wishes.forEach((p) => ((p.items as Data[]) || []).forEach((w) => { if (D.done.includes(String(w.id))) doneList.push(esc(p.pref) + '・' + esc(w.n)); }));
  if (doneList.length) h += '<section class="card"><h2>かなえたこと</h2><p style="margin:0">' + doneList.join('<br>') + '</p></section>';
  if (D.budget) {
    const sum: Record<string, number> = {}; let all = 0;
    D.expenses.forEach((e) => { const a = Number(e.amount) || 0; sum[String(e.cat)] = (sum[String(e.cat)] || 0) + a; all += a; });
    const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');
    h += '<section class="card"><h2>お金</h2><div class="row"><span>使った額</span><b>' + yen(all) + '</b></div>' + Object.keys(sum).map((k) => '<div class="row"><span>' + esc(k) + '</span><span>' + yen(sum[k]) + '</span></div><div class="bar"><b style="width:' + (all ? (sum[k] / all * 100).toFixed(1) : 0) + '%"></b></div>').join('') + '</section>';
  }
  if (D.bookings.length) h += '<section class="card"><h2>移動・見学</h2>' + D.bookings.map((b) => '<div class="row"><span>' + esc(b.title) + '</span><span class="sub">' + esc(b.kind) + '</span></div>').join('') + '</section>';
  h += '<footer>この旅は <a href="' + esc(D.appUrl) + '">旅帳</a> でまとめました' + (Object.keys(G).length ? '<br>地図: 地球地図日本（国土地理院）を加工' : '') + '</footer>';
  return h;
}

// 見るだけのページのひな形。スクリプトを使わず、このファイルだけで表示できる
const VIEWER = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>__TITLE__ - 旅帳</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#E7EDF0;color:#1B2428;font-family:-apple-system,"Hiragino Sans","Noto Sans JP",system-ui,sans-serif;font-size:15px;line-height:1.7;overflow-wrap:anywhere;-webkit-text-size-adjust:100%}
.wrap{max-width:820px;margin:0 auto;padding:16px 16px 40px;display:flex;flex-direction:column;gap:16px}
header h1{margin:0;font-size:26px;line-height:1.3}
.sub{color:#5A666C;font-size:13px;margin:0}
.card{background:#fff;border:1px solid #D5DDE0;border-radius:12px;padding:16px}
h2{margin:0 0 10px;font-size:18px}
.stats{display:flex;gap:20px;flex-wrap:wrap;margin-top:8px}
.stats b{display:block;font-size:22px}
.map{background:#E7EDF0;border-radius:10px;overflow:hidden}
.map svg{width:100%;height:auto;display:block}
.stop{display:grid;grid-template-columns:64px minmax(0,1fr);gap:10px;padding:10px 0;border-bottom:1px solid #D5DDE0}
.stop:last-child{border-bottom:0}
.d{font-size:13px;color:#5A666C}
.pill{display:inline-block;border-radius:6px;padding:0 6px;font-size:11.5px;background:#F1F4F5;color:#5A666C;margin-left:6px}
.entry{display:flex;flex-direction:column;gap:8px;padding:12px 0;border-bottom:1px solid #D5DDE0}
.entry:last-child{border-bottom:0}
.entry p{margin:0;white-space:pre-wrap}
.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
.photos img{width:100%;height:auto;border-radius:8px;display:block;max-width:100%}
.bar{height:10px;border-radius:5px;background:#F1F4F5;overflow:hidden;margin-bottom:6px}
.bar b{display:block;height:10px;background:#1F4FA0}
.row{display:flex;justify-content:space-between;gap:12px;font-size:14px}
footer{text-align:center;font-size:12px;color:#5A666C}
footer a{color:#1F4FA0}
</style>
</head>
<body>
<div class="wrap">
__BODY__
</div>
</body>
</html>`;
