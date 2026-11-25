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

/**
 * まとめ画像（PNG）。LINE やインスタのストーリーにそのまま送れる、縦長（1080×1920）のポスター。
 * 紺の背景に、泊まった都道府県を塗った地図とルート、大きな数字3つ（泊数・泊まった所・都道府県）、
 * 「長崎市 → 熊本市 → …」とつないだ行程、日記の写真（最大4枚）を描く。
 * 見せる項目の選び方（日付を隠す、写真を入れない など）は、ほかの形と同じに従う。
 */
const PREF_NAMES = ['北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島', '茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川', '新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知', '三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山', '鳥取', '島根', '岡山', '広島', '山口', '徳島', '香川', '愛媛', '高知', '福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'];

export async function shareImage(store: Store, b: ShareBuild, geo: Record<string, string> | null, appUrl: string, pick?: string[]): Promise<Blob> {
  const get = (col: string) => b.records.filter((r) => r.col === 'trips/' + b.tripId + '/' + col).map((r) => ({ id: r.id, ...(r.data || {}) }) as Data & { id: string });
  const meta = b.records.find((r) => r.path === 'trips/' + b.tripId + '/meta/trip')?.data || {};
  const relative = !!meta.relative; const start = parseD(String(meta.start || DUMMY_START));
  let total = 0;
  const stops = get('stops').sort((x, y) => Number(x.order || 0) - Number(y.order || 0));
  stops.forEach((s) => { total += Number(s.nights) || 0; });
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + total);
  // 訪れた都道府県（地図で塗る）
  const visited = new Set<string>();
  stops.forEach((s) => { const i = PREF_NAMES.findIndex((p) => String(s.pref || '').startsWith(p)); if (i >= 0) visited.add(String(i + 1).padStart(2, '0')); });
  // 行程の文（同じ場所が続くときは1つにまとめる）
  const chain: string[] = []; stops.forEach((s) => { if (s.kind === 'S') return; const pl = String(s.place || ''); if (pl && chain[chain.length - 1] !== pl) chain.push(pl); }); // 船中泊は行程の文に入れない
  // 選んだ写真があればそれを使う（写真を見せない設定のときは入れない）。なければ日記の日付順に最大4枚
  const allIds = get('diary').sort((a, c) => (a.id < c.id ? -1 : 1)).flatMap((d) => (d.photos as string[]) || []);
  const photoIds = (pick ? pick.filter((id) => allIds.includes(id)) : allIds).slice(0, 4);
  const imgs: ImageBitmap[] = [];
  for (const id of photoIds) { const blob = await store.getPhoto(id); if (blob) { try { imgs.push(await createImageBitmap(blob)); } catch { /* 読めない写真は飛ばす */ } } }

  const W = 1080, H = 1920, P = 72;
  const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",sans-serif';
  const NUM = '"Avenir Next","Helvetica Neue",' + FONT;
  const C = { bg: '#10213B', panel: '#152A4A', land: '#22395D', edge: '#2E4A74', visited: '#E3A63A', route: '#FFFFFF', ink: '#FFFFFF', muted: '#A9B8CE', gold: '#E3A63A', ship: '#8FD3CE', plane: '#C6D0DD' };
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'); if (!g) throw new Error('canvas not available');
  const font = (size: number, weight = 400, fam = FONT) => { g.font = weight + ' ' + size + 'px ' + fam; };
  const fitText = (s: string, maxW: number) => { let t = s; if (g.measureText(t).width <= maxW) return t; while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; };
  const round = (x: number, y: number, w: number, h: number, r: number) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);

  // 見出し
  font(26, 700); g.fillStyle = C.gold; g.fillText('旅帳  TRAVEL LOG', P, 118);
  let size = 76; font(size, 800); while (size > 44 && g.measureText(b.name).width > W - P * 2) { size -= 4; font(size, 800); }
  g.fillStyle = C.ink; g.fillText(fitText(b.name, W - P * 2), P, 210);
  const fmt = (d: Date) => d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate();
  font(32, 400); g.fillStyle = C.muted;
  g.fillText(stops.length ? (relative ? total + '泊の旅' : fmt(start) + ' – ' + (end.getMonth() + 1) + '.' + end.getDate() + '　' + total + '泊') : '', P, 266);

  // 地図
  const mx = P, my = 320, mw = W - P * 2, mh = 820;
  g.save(); round(mx, my, mw, mh, 40); g.clip(); g.fillStyle = C.panel; g.fillRect(mx, my, mw, mh);
  const COS = Math.cos(36 * Math.PI / 180), PX = (l: number) => (l - 122.5) * COS * 100, PY = (l: number) => (45.8 - l) * 100;
  const pts = stops.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number') as unknown as (Data & { lat: number; lng: number; arrive?: string })[];
  if (pts.length || geo) {
    const xs = pts.length ? pts.map((s) => PX(s.lng)) : [0, 1901], ys = pts.length ? pts.map((s) => PY(s.lat)) : [0, 2180];
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const span = Math.max(x1 - x0, (y1 - y0) * mw / mh, 220) * 1.22; const spanY = span * mh / mw;
    const k = mw / span, ox = (x0 + x1) / 2 - span / 2, oy = (y0 + y1) / 2 - spanY / 2;
    g.translate(mx - ox * k, my - oy * k); g.scale(k, k);
    if (geo) Object.keys(geo).forEach((code) => {
      const d = geo[code]; if (!d) return; const p2 = new Path2D(d);
      g.fillStyle = visited.has(code) ? C.visited : C.land; g.fill(p2);
      g.strokeStyle = visited.has(code) ? '#C98E2A' : C.edge; g.lineWidth = 1.4 / k; g.stroke(p2);
    });
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], c = pts[i], m = c.arrive || 'car';
      g.beginPath(); g.moveTo(PX(a.lng), PY(a.lat)); g.lineTo(PX(c.lng), PY(c.lat));
      g.strokeStyle = m === 'ship' ? C.ship : m === 'plane' ? C.plane : C.route; g.lineWidth = (m === 'car' ? 6 : 4) / k;
      g.setLineDash(m === 'ship' ? [14 / k, 10 / k] : m === 'plane' ? [2 / k, 12 / k] : []); g.stroke();
    }
    g.setLineDash([]);
    pts.forEach((s, i) => {
      const first = i === 0;
      g.beginPath(); g.arc(PX(s.lng), PY(s.lat), (first ? 16 : 9) / k, 0, Math.PI * 2);
      g.fillStyle = first ? C.gold : C.route; g.fill(); g.lineWidth = 4 / k; g.strokeStyle = C.bg; g.stroke();
    });
    if (pts.length) {
      // 出発地の名前
      g.setTransform(1, 0, 0, 1, 0, 0);
      const sx = mx + (PX(pts[0].lng) - ox) * k, sy = my + (PY(pts[0].lat) - oy) * k;
      font(28, 700); const lab = '出発 ' + String(stops[0].place || ''); const tw = g.measureText(lab).width;
      const lx = Math.min(Math.max(sx - tw / 2 - 16, mx + 16), mx + mw - tw - 48), ly = Math.min(sy + 30, my + mh - 64);
      round(lx, ly, tw + 32, 48, 24); g.fillStyle = C.gold; g.fill(); g.fillStyle = C.bg; g.fillText(lab, lx + 16, ly + 34);
    }
  }
  g.restore();

  // 大きな数字
  const sy0 = 1196;
  const stats: [string, string, string][] = [[String(total), '泊', '泊数'], [String(chain.length), 'か所', '泊まった所'], [String(visited.size), '/47', '都道府県']];
  const cw = (W - P * 2) / 3;
  stats.forEach(([n, unit, lab], i) => {
    const x = P + cw * i;
    font(84, 800, NUM); g.fillStyle = C.ink; g.fillText(n, x, sy0 + 84); const nw = g.measureText(n).width;
    font(34, 700); g.fillStyle = C.ink; g.fillText(unit, x + nw + 6, sy0 + 84);
    font(26, 400); g.fillStyle = C.muted; g.fillText(lab, x, sy0 + 128);
    if (i) { g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(x - 24, sy0 + 20, 2, 110); }
  });

  // 行程の文
  const photoTop = imgs.length ? H - 120 - (imgs.length <= 2 ? 300 : 216) : H - 120;
  const cy0 = sy0 + 200, lineH = 46, maxLines = Math.max(1, Math.floor((photoTop - 40 - cy0) / lineH));
  font(26, 700); g.fillStyle = C.gold; g.fillText('ROUTE', P, cy0);
  font(30, 500); g.fillStyle = C.ink;
  const lines: string[] = []; let line = ''; let used = 0;
  for (let i = 0; i < chain.length; i++) {
    const piece = (line ? ' → ' : (lines.length ? '→ ' : '')) + chain[i];
    if (g.measureText(line + piece).width > W - P * 2) {
      if (lines.length + 1 >= maxLines) { break; }
      lines.push(line); line = '→ ' + chain[i];
    } else line += piece;
    used = i + 1;
  }
  if (used < chain.length) {
    const rest = ' …ほか' + (chain.length - used) + 'か所';
    while (line && g.measureText(line + rest).width > W - P * 2) { const k = line.lastIndexOf(' → '); if (k <= 0) break; line = line.slice(0, k); used--; }
    line += ' …ほか' + (chain.length - used) + 'か所';
  }
  if (line) lines.push(line);
  lines.forEach((l, i) => { g.fillStyle = C.ink; g.fillText(l, P, cy0 + 52 + i * lineH); });

  // 写真
  if (imgs.length) {
    const n = imgs.length, gap = 20, cell = n <= 2 ? (W - P * 2 - gap) / 2 : (W - P * 2 - gap * 3) / 4;
    const ch = n <= 2 ? 300 : cell;
    imgs.forEach((im, i) => {
      const x = P + i * (cell + gap), y = photoTop;
      const r = cell / ch, sw = Math.min(im.width, im.height * r), sh = sw / r;
      g.save(); round(x, y, cell, ch, 24); g.clip();
      g.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, x, y, cell, ch); g.restore(); im.close();
    });
  }
  font(24, 400); g.fillStyle = C.muted; g.fillText('旅帳でまとめました　' + appUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''), P, H - 56);
  return await new Promise<Blob>((ok, ng) => cv.toBlob((bl) => (bl ? ok(bl) : ng(new Error('画像を作れませんでした'))), 'image/png'));
}
