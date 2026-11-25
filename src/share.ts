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
 * まとめ画像（PNG）。LINE やインスタなどにそのまま送れる。
 * 地図とルート、泊数などの数字、行程の一覧、日記の写真（最大4枚）を縦長の1枚に描く。
 * 見せる項目の選び方（日付を隠す、写真を入れない など）は、ほかの形と同じに従う。
 */
export async function shareImage(store: Store, b: ShareBuild, geo: Record<string, string> | null, appUrl: string): Promise<Blob> {
  const get = (col: string) => b.records.filter((r) => r.col === 'trips/' + b.tripId + '/' + col).map((r) => ({ id: r.id, ...(r.data || {}) }) as Data & { id: string });
  const meta = b.records.find((r) => r.path === 'trips/' + b.tripId + '/meta/trip')?.data || {};
  const relative = !!meta.relative; const start = parseD(String(meta.start || DUMMY_START));
  const WD = '日月火水木金土';
  const label = (d: Date) => (relative ? (dayDiff(start, d) + 1) + '日目' : (d.getMonth() + 1) + '/' + d.getDate() + '（' + WD[d.getDay()] + '）');
  let cur = start, total = 0;
  const stops = get('stops').sort((x, y) => Number(x.order || 0) - Number(y.order || 0)).map((s) => { const a = cur; const n = Number(s.nights) || 0; cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + n); total += n; return { ...s, s: a, n } as Data & { id: string; s: Date; n: number }; });
  let items = 0, dn = 0; const done = new Set(get('wishdone').map((d) => d.id));
  get('wishes').forEach((p) => ((p.items as Data[]) || []).forEach((w) => { items++; if (done.has(String(w.id))) dn++; }));
  // 写真は日記の日付順に最大4枚
  const photoIds = get('diary').sort((a, c) => (a.id < c.id ? -1 : 1)).flatMap((d) => (d.photos as string[]) || []).slice(0, 4);
  const imgs: ImageBitmap[] = [];
  for (const id of photoIds) { const blob = await store.getPhoto(id); if (blob) { try { imgs.push(await createImageBitmap(blob)); } catch { /* 読めない写真は飛ばす */ } } }

  const W = 1080, P = 64, FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",sans-serif';
  const MAX_ROWS = 40, ROW = 64;
  const rows = stops.slice(0, MAX_ROWS);
  const mapH = 760, photoH = imgs.length ? (imgs.length <= 2 ? 460 : 920) + 40 : 0;
  const H = P + 150 + mapH + 40 + 150 + 70 + rows.length * ROW + (stops.length > MAX_ROWS ? ROW : 0) + 40 + photoH + 120;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'); if (!g) throw new Error('canvas not available');
  const C = { sea: '#E7EDF0', land: '#FBFBF8', line: '#D5DDE0', ink: '#1B2428', muted: '#5A666C', road: '#1F4FA0', ship: '#1F7470', plane: '#6B7378', card: '#FFFFFF' };
  const text = (s: string, x: number, y: number, size: number, color = C.ink, weight = 400, maxW = W - P * 2) => {
    g.font = weight + ' ' + size + 'px ' + FONT; g.fillStyle = color;
    let t = s; if (g.measureText(t).width > maxW) { while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); t += '…'; }
    g.fillText(t, x, y); return g.measureText(t).width;
  };
  const round = (x: number, y: number, w: number, h: number, r: number) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  g.fillStyle = C.sea; g.fillRect(0, 0, W, H);
  let y = P + 56;
  text(b.name, P, y, 56, C.ink, 800); y += 64;
  text(stops.length ? (relative ? total + '泊の旅' : label(start) + '〜' + label(cur) + '・' + total + '泊') : '', P, y, 30, C.muted); y += 40;

  // 地図
  const mx = P, my = y, mw = W - P * 2;
  g.save(); round(mx, my, mw, mapH, 28); g.clip(); g.fillStyle = C.sea; g.fillRect(mx, my, mw, mapH);
  const COS = Math.cos(36 * Math.PI / 180), PX = (l: number) => (l - 122.5) * COS * 100, PY = (l: number) => (45.8 - l) * 100;
  const pts = stops.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number') as unknown as (Data & { lat: number; lng: number; arrive?: string })[];
  if (pts.length) {
    const xs = pts.map((s) => PX(s.lng)), ys = pts.map((s) => PY(s.lat));
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const span = Math.max(x1 - x0, (y1 - y0) * mw / mapH, 160); const spanY = span * mapH / mw;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; const pad = 1.18;
    const k = mw / (span * pad); x0 = cx - span * pad / 2; y0 = cy - spanY * pad / 2;
    g.translate(mx - x0 * k, my - y0 * k); g.scale(k, k);
    g.fillStyle = C.land; g.strokeStyle = C.line; g.lineWidth = 1.2 / k;
    if (geo) Object.values(geo).forEach((d) => { if (d) { const p2 = new Path2D(d); g.fill(p2); g.stroke(p2); } });
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], c = pts[i], m = c.arrive || 'car';
      g.beginPath(); g.moveTo(PX(a.lng), PY(a.lat)); g.lineTo(PX(c.lng), PY(c.lat));
      g.strokeStyle = m === 'ship' ? C.ship : m === 'plane' ? C.plane : C.road; g.lineWidth = 5 / k; g.lineCap = 'round';
      g.setLineDash(m === 'ship' ? [12 / k, 9 / k] : m === 'plane' ? [2 / k, 10 / k] : []); g.stroke();
    }
    g.setLineDash([]);
    pts.forEach((s) => { g.beginPath(); g.arc(PX(s.lng), PY(s.lat), 11 / k, 0, Math.PI * 2); g.fillStyle = C.road; g.fill(); g.lineWidth = 4 / k; g.strokeStyle = C.land; g.stroke(); });
  }
  g.restore();
  y = my + mapH + 40;

  // 数字
  round(P, y, W - P * 2, 150, 24); g.fillStyle = C.card; g.fill();
  const stat = (i: number, n: number, lab: string, val: string) => { const cw = (W - P * 2) / n; const x = P + cw * i + 36; text(lab, x, y + 56, 26, C.muted, 400, cw - 40); text(val, x, y + 112, 50, C.ink, 800, cw - 40); };
  const stats: [string, string][] = [['泊数', total + '泊'], ['泊まった所', stops.length + 'か所']];
  if (items) stats.push(['やりたいこと', dn + ' / ' + items]);
  stats.forEach(([l, v], i) => stat(i, stats.length, l, v));
  y += 150 + 70;

  // 行程
  text('行程', P, y - 16, 34, C.ink, 800);
  round(P, y, W - P * 2, rows.length * ROW + (stops.length > MAX_ROWS ? ROW : 0) + 16, 24); g.fillStyle = C.card; g.fill();
  y += 8;
  rows.forEach((s, i) => {
    const ry = y + i * ROW;
    if (i) { g.fillStyle = C.line; g.fillRect(P + 28, ry, W - P * 2 - 56, 1); }
    text(label(s.s), P + 28, ry + 42, 26, C.muted, 400, 200);
    const pw = text(String(s.place || ''), P + 250, ry + 42, 30, C.ink, 700, 430);
    text(String(s.pref || '') + '・' + s.n + '泊', P + 250 + pw + 16, ry + 42, 24, C.muted, 400, W - P * 2 - 250 - pw - 60);
  });
  if (stops.length > MAX_ROWS) text('ほか ' + (stops.length - MAX_ROWS) + 'か所', P + 250, y + rows.length * ROW + 42, 26, C.muted);
  y += rows.length * ROW + (stops.length > MAX_ROWS ? ROW : 0) + 8 + 40;

  // 写真（正方形に切り抜いて並べる）
  if (imgs.length) {
    const cols = 2, gap = 20, cell = (W - P * 2 - gap) / cols;
    imgs.forEach((im, i) => {
      const x = P + (i % cols) * (cell + gap), yy = y + Math.floor(i / cols) * (cell + gap);
      const s = Math.min(im.width, im.height);
      g.save(); round(x, yy, cell, cell, 20); g.clip();
      g.drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, x, yy, cell, cell); g.restore(); im.close();
    });
    y += (imgs.length <= 2 ? cell : cell * 2 + gap) + 40;
  }
  text('旅帳でまとめました　' + appUrl.replace(/^https?:\/\//, ''), P, H - 56, 24, C.muted);
  return await new Promise<Blob>((ok, ng) => cv.toBlob((bl) => (bl ? ok(bl) : ng(new Error('画像を作れませんでした'))), 'image/png'));
}
