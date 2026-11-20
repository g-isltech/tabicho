
// 画面の本体。アーティファクト版の旅帳から移したもの。
// データは ctx.db（端末内のストア）と ctx.assets（写真）を通して読み書きする。
export function startApp(ctx) {
  // ---------- 定数 ----------
  const REG = [
    ['北海道', '#23406B'], ['東北', '#1F7470'], ['関東', '#2B5F94'], ['中部', '#7A4E2D'],
    ['近畿', '#8A5A12'], ['中国', '#6B4C9A'], ['四国', '#2F7A4A'], ['九州・沖縄', '#B4492E']
  ];
  // 都道府県庁のおおよその位置（PREFS と同じ並び）。場所の検索ができないときの目安に使う
  const PREF_POS = [[43.06,141.35],[40.82,140.74],[39.70,141.15],[38.27,140.87],[39.72,140.10],[38.24,140.36],[37.75,140.47],[36.34,140.45],[36.57,139.88],[36.39,139.06],[35.86,139.65],[35.61,140.12],[35.69,139.69],[35.45,139.64],[37.90,139.02],[36.70,137.21],[36.59,136.63],[36.07,136.22],[35.66,138.57],[36.65,138.18],[35.39,136.72],[34.98,138.38],[35.18,136.91],[34.73,136.51],[35.00,135.87],[35.02,135.76],[34.69,135.52],[34.69,135.18],[34.69,135.83],[34.23,135.17],[35.50,134.24],[35.47,133.05],[34.66,133.93],[34.40,132.46],[34.19,131.47],[34.07,134.56],[34.34,134.04],[33.84,132.77],[33.56,133.53],[33.61,130.42],[33.25,130.30],[32.74,129.87],[32.79,130.74],[33.24,131.61],[31.91,131.42],[31.56,130.56],[26.21,127.68]];
  // 地名から位置を探す（国土地理院の住所検索）。都道府県が分かっていれば、その県の結果を優先する
  async function geocode(place, pref) {
    const full = pref ? (pref === '北海道' ? '北海道' : pref === '東京' ? '東京都' : (pref === '京都' || pref === '大阪') ? pref + '府' : pref + '県') : '';
    const q = (full && !String(place).startsWith(pref) ? full + ' ' : '') + place;
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q), { signal: ctl.signal });
      const list = await r.json(); if (!Array.isArray(list) || !list.length) return null;
      // 都道府県を選んでいるときは、その県の結果だけを使う（同じ地名がほかの県にあることがあるため）
      const hit = full ? list.find((f) => String(f.properties && f.properties.title).startsWith(full)) : list[0];
      if (!hit) return null;
      const [lng, lat] = hit.geometry.coordinates; return { lat: Math.round(lat * 10000) / 10000, lng: Math.round(lng * 10000) / 10000 };
    } catch (e) { return null; } finally { clearTimeout(tm); }
  }
  // 都道府県の並び（PREFS）の何番目からどの地方か
  const regionOfPref = (name) => { const i = PREFS.findIndex((p) => name && String(name).startsWith(p)); if (i < 0) return -1; return i === 0 ? 0 : i <= 6 ? 1 : i <= 13 ? 2 : i <= 22 ? 3 : i <= 29 ? 4 : i <= 34 ? 5 : i <= 38 ? 6 : 7; };
  const LODG = { '車中泊': '#2B5F94', 'テント泊': '#2F7A4A', '安い宿': '#9A958B', 'ホテル': '#6B4C9A', '温泉旅館': '#C2581B', '知人宅': '#8A5A12', '船中泊': '#1F7470', 'その他': '#555555' };
  // 予約の画面で「車中泊・キャンプ」にまとめる泊まり方
  const OUTDOOR = ['車中泊', 'テント泊'];
  const MAX_NIGHTS = 60;
  const KIND = { B: '拠点', T: '途中泊', S: '船' };
  const BOOK = { none: '未予約', booked: '予約済み', paid: '支払い済み' };
  const BKIND = ['飛行機', '船', 'レンタカー', '駐車場', '見学・体験', '宿', 'その他'];
  const CATS = [
    { k: '宿泊', b: '宿泊' }, { k: '食費', b: '食費' }, { k: '交通', b: '交通', hint: 'フェリー・飛行機・レンタカー・駐車場' },
    { k: 'ガソリン・高速', b: 'ガソリン・高速' }, { k: '観光・体験', b: '観光・体験' }, { k: 'その他', b: '予備費' }
  ];
  const PREFS = ['北海道','青森','岩手','宮城','秋田','山形','福島','茨城','栃木','群馬','埼玉','千葉','東京','神奈川','新潟','富山','石川','福井','山梨','長野','岐阜','静岡','愛知','三重','滋賀','京都','大阪','兵庫','奈良','和歌山','鳥取','島根','岡山','広島','山口','徳島','香川','愛媛','高知','福岡','佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄'];
  const VIEWS = [
    { id: 'map', label: '地図', icon: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>' },
    { id: 'plan', label: '行程', icon: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>' },
    { id: 'book', label: '予約', icon: '<path d="M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/><path d="M14 7v12" stroke-dasharray="2 2"/>' },
    { id: 'money', label: 'お金', icon: '<circle cx="12" cy="12" r="9"/><path d="M8 8l4 5 4-5M12 13v5M9 14h6M9 16.5h6"/>' },
    { id: 'wish', label: 'やりたい', icon: '<path d="M4 12l5 5L20 6"/>' },
    { id: 'diary', label: '日記', icon: '<path d="M5 3h11l3 3v15H5z"/><path d="M9 9h6M9 13h6M9 17h4"/>' }
  ];
  const COS = Math.cos(36 * Math.PI / 180);
  const PX = (lng) => (lng - 122.5) * COS * 100;
  const PY = (lat) => (45.8 - lat) * 100;
  const FULL = { x: 0, y: 0, w: 1901, h: 2180 };
  const ZONES = [
    ['全体', null], ['北海道', [139.3, 146, 41.2, 45.6]], ['東北', [139.0, 142.4, 36.8, 41.7]], ['関東・中部', [135.8, 141.0, 34.4, 38.0]],
    ['近畿', [134.2, 137.0, 33.3, 35.9]], ['中国・四国', [130.8, 134.8, 32.6, 35.8]], ['九州', [128.8, 132.3, 30.1, 34.4]], ['奄美・沖縄', [123.6, 130.2, 24.0, 28.8]]
  ];

  // ---------- 状態 ----------
  const S = {
    stops: [], wishPrefs: {}, done: {}, bookings: [], expenses: [], diary: {},
    trip: { start: '' }, budget: null,
    loaded: { stops: false, wishes: false, bookings: false, expenses: false },
    db: null, assets: null, me: '', live: false
  };
  const UI = { view: 'map', zone: 0, vb: { ...FULL }, sel: null, wishPref: null, wishKind: 'all', hideDone: false,
    bookFilter: 'all', expAll: false, diaryDate: null, geo: null };
  try { const s = JSON.parse(localStorage.getItem('tabicho-ui') || '{}'); if (s.hideDone) UI.hideDone = true; } catch (e) {}

  // ---------- 便利関数 ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = (n) => '¥' + Math.round(n || 0).toLocaleString('ja-JP');
  const man = (n) => (Math.round((n || 0) / 1000) / 10).toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + '万円';
  const WD = '日月火水木金土';
  const parseD = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const md = (d) => (d.getMonth() + 1) + '/' + d.getDate();
  const mdw = (d) => md(d) + '（' + WD[d.getDay()] + '）';
  const today = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };
  const dayDiff = (a, b) => Math.round((b - a) / 86400000);
  const icon = (p, s = 22) => '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';

  function schedule() {
    let d = parseD(S.trip.start || iso(today()));
    return S.stops.map((st, i) => { const a = d; d = addD(d, Math.max(0, +st.nights || 0)); return { ...st, idx: i, start: a, end: d }; });
  }
  function tripInfo(sch) {
    const t = today();
    const start = parseD(S.trip.start || iso(today()));
    const end = sch.length ? sch[sch.length - 1].end : start;
    const total = dayDiff(start, end);
    const cur = sch.find((s) => t >= s.start && t < s.end) || null;
    const next = sch.find((s) => s.start > t) || null;
    let phase = 'before'; if (t >= start && t < end) phase = 'during'; else if (t >= end) phase = 'after';
    return { t, start, end, total, cur, next, phase, day: dayDiff(start, t) + 1 };
  }
  function toast(msg) {
    const r = $('#toast-root'); r.innerHTML = '<div class="toast" role="status">' + esc(msg) + '</div>';
    clearTimeout(toast._t); toast._t = setTimeout(() => { r.innerHTML = ''; }, 2200);
  }
  function fail(e) {
    const full = e && e.name === 'QuotaExceededError';
    toast(full ? 'この端末の保存できる容量がいっぱいです。写真を減らすか、書き出してから古い旅を消してください' : '保存できませんでした。もう一度試してください');
  }
  const can = () => !!S.db;
  function doneBy(v) {
    if (!v || !v.at) return '';
    return '<br><span class="done-by">達成 ' + md(new Date(v.at)) + '</span>';
  }

  // ---------- 描画の司令塔 ----------
  let raf = 0;
  function render() { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }
  let pending = false;
  document.addEventListener('focusout', () => { if (pending) { pending = false; setTimeout(render, 0); } });
  function typing() {
    const a = document.activeElement; if (!a || !$('#view').contains(a)) return false;
    if (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') return true;
    return a.tagName === 'INPUT' && !/^(checkbox|radio|file|button|submit)$/.test(a.type);
  }
  function draw() {
    if (typing()) { pending = true; return; }
    const sch = schedule();
    const ti = tripInfo(sch);
    const st = $('#status');
    if (!S.loaded.stops) st.textContent = '読み込み中';
    else if (!sch.length) st.textContent = '行程はまだありません';
    else if (ti.phase === 'before') st.textContent = '出発まであと' + dayDiff(ti.t, ti.start) + '日・' + mdw(ti.start) + ' ' + (sch[0] ? sch[0].place + '発・' : '') + ti.total + '泊';
    else if (ti.phase === 'during') st.textContent = (ti.day) + '日目 / ' + ti.total + '泊・今夜は' + (ti.cur ? ti.cur.place : '');
    else st.textContent = '旅は' + mdw(ti.end) + 'に終わりました・' + ti.total + '泊';
    $('#syncdot').className = 'dot' + (S.live ? ' on' : '');
    $('#synctext').textContent = S.live ? 'この端末に保存' : '準備中';
    $('#tabs').innerHTML = VIEWS.map((v) => '<a class="tab" href="#' + v.id + '"' + (UI.view === v.id ? ' aria-current="page"' : '') + '>' + icon(v.icon) + '<span>' + v.label + '</span></a>').join('');
    const fn = { map: vMap, plan: vPlan, book: vBook, money: vMoney, wish: vWish, diary: vDiary }[UI.view];
    const keep = UI.view === 'map' && $('#mapsvg');
    if (keep) { updateMap(sch, ti); const ms = $('#mapsel'); if (ms) ms.innerHTML = mapSel(sch, ti); return; }
    $('#view').innerHTML = fn(sch, ti);
    if (UI.view === 'map') { initMap(); updateMap(sch, ti); }
  }

  // ---------- 地図 ----------
  function prefPct(code) {
    const p = S.wishPrefs[code]; if (!p || !p.items || !p.items.length) return null;
    const n = p.items.filter((w) => S.done[w.id]).length; return n / p.items.length;
  }
  function mapSel(sch, ti) {
    const focus = ti.cur || ti.next || sch[0];
    const s = UI.sel ? sch.find((x) => x.id === UI.sel) : null;
    if (s) return stopSummary(s, '選んだ場所');
    return focus ? stopSummary(focus, ti.cur ? '今夜' : (ti.phase === 'before' ? '最初の泊まり' : '次の泊まり')) : stopSummary(null);
  }
  function vMap(sch, ti) {
    return '<section class="card map-card" aria-label="旅の地図">' +
      '<div class="map-chips"><div class="chips scroll" role="group" aria-label="地域で拡大">' + ZONES.map((z, i) => '<button class="chip" data-zone="' + i + '" aria-pressed="' + (UI.zone === i) + '">' + z[0] + '</button>').join('') + '</div></div>' +
      '<div class="map-box" id="mapbox"><svg id="mapsvg" role="img" aria-label="日本地図。泊まる場所と、回る順番の線"><g id="g-pref"></g><g id="g-route"></g><g id="g-pin"></g></svg>' +
      '<div class="map-tools"><button type="button" data-zoom="in" aria-label="拡大">＋</button><button type="button" data-zoom="out" aria-label="縮小">−</button></div></div>' +
      '<div class="map-legend"><span><svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--road)" stroke-width="3"/></svg>車</span>' +
      '<span><svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--ship)" stroke-width="3" stroke-dasharray="6 4"/></svg>船</span>' +
      '<span><svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--plane)" stroke-width="2.5" stroke-dasharray="2 4" stroke-linecap="round"/></svg>飛行機</span>' +
      '<span><svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 4"/></svg>最後の泊まりから出発地へ戻る</span>' +
      '<span><i class="lg" style="background:var(--road-soft);background:color-mix(in srgb,var(--road) 55%,var(--land))"></i>色が濃い県ほど「やりたい」を達成</span></div>' +
      '<p class="credit">地図: 地球地図日本（国土地理院）を加工</p></section>' +
      '<section class="card" id="mapsel">' + mapSel(sch, ti) + '</section>';
  }
  function stopSummary(s, label) {
    if (!s) return '<div class="empty">泊まる場所を地図で選ぶと、ここに詳しく出ます</div>';
    const c = REG[s.region] ? REG[s.region][1] : '#555';
    return '<div class="next"><div class="badge-n" style="background:' + c + '">' + (s.idx + 1) + '</div><div style="min-width:0;display:flex;flex-direction:column;gap:6px">' +
      '<p class="sub">' + esc(label) + '・' + mdw(s.start) + '〜' + mdw(s.end) + '</p>' +
      '<div class="row"><h2>' + esc(s.place) + '</h2><span class="pill' + (s.kind === 'B' ? ' base' : '') + '">' + (KIND[s.kind] || '') + '</span><span class="pill ' + esc(s.booking || 'none') + '">' + (BOOK[s.booking] || '未予約') + '</span></div>' +
      '<p class="sub">' + esc(s.pref) + '・' + (+s.nights || 0) + '泊・' + esc(s.lodging) + (s.lodgingName ? '（' + esc(s.lodgingName) + '）' : '') + '</p>' +
      (s.what ? '<p style="margin:0;font-size:14px">' + esc(s.what) + '</p>' : '') +
      '<div class="row"><button class="btn small" data-edit-stop="' + esc(s.id) + '">この泊まりを編集</button><a class="btn small" href="#plan">行程で見る</a></div></div></div>';
  }
  function initMap() {
    const svg = $('#mapsvg'); if (!svg) return;
    const gp = $('#g-pref');
    if (UI.geo) gp.innerHTML = Object.keys(UI.geo).filter((k) => UI.geo[k]).map((k) => '<path data-code="' + k + '" d="' + UI.geo[k] + '" fill="var(--land)" stroke="var(--line)" stroke-width="1" stroke-linejoin="round"/>').join('');
    applyVB();
    const ptrs = new Map(); let last = null, travel = 0;
    svg.addEventListener('pointerdown', (e) => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = null; travel = 0; UI.moved = false; });
    svg.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return;
      const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) {
        travel += Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
        if (travel > 6 && !UI.moved) { UI.moved = true; try { svg.setPointerCapture(e.pointerId); } catch (er) {} }
        if (!UI.moved) return;
        const k = Math.max(UI.vb.w / svg.clientWidth, UI.vb.h / svg.clientHeight);
        UI.vb.x -= (e.clientX - prev.x) * k; UI.vb.y -= (e.clientY - prev.y) * k; applyVB();
      } else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()]; const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (last) zoomAt(last / dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
        last = dist; UI.moved = true;
      }
    });
    const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) last = null; };
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
    svg.addEventListener('click', (e) => {
      if (UI.moved) { UI.moved = false; return; }
      const pin = e.target.closest('[data-pin]'); if (!pin) return;
      UI.sel = pin.getAttribute('data-pin');
      const sch = schedule(); const s = sch.find((x) => x.id === UI.sel);
      $('#mapsel').innerHTML = stopSummary(s, '選んだ場所'); updatePins(sch, tripInfo(sch));
    });
  }
  function zoomAt(f, cx, cy) {
    const svg = $('#mapsvg'); const r = svg.getBoundingClientRect();
    const k = Math.max(UI.vb.w / r.width, UI.vb.h / r.height);
    const ox = (r.width - UI.vb.w / k) / 2, oy = (r.height - UI.vb.h / k) / 2;
    const mx = UI.vb.x + (cx - r.left - ox) * k, my = UI.vb.y + (cy - r.top - oy) * k;
    const nw = Math.min(Math.max(UI.vb.w * f, 120), FULL.w * 1.4), nh = nw * UI.vb.h / UI.vb.w;
    UI.vb.x = mx - (mx - UI.vb.x) * nw / UI.vb.w; UI.vb.y = my - (my - UI.vb.y) * nh / UI.vb.h; UI.vb.w = nw; UI.vb.h = nh; applyVB();
  }
  function setZone(i) {
    UI.zone = i; const z = ZONES[i][1];
    if (!z) UI.vb = { ...FULL };
    else { const x0 = PX(z[0]), x1 = PX(z[1]), y0 = PY(z[3]), y1 = PY(z[2]); UI.vb = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
    document.querySelectorAll('[data-zone]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.zone === i)));
    applyVB();
  }
  function applyVB() {
    const svg = $('#mapsvg'); if (!svg) return;
    svg.setAttribute('viewBox', [UI.vb.x, UI.vb.y, UI.vb.w, UI.vb.h].map((n) => n.toFixed(1)).join(' '));
    const sch = schedule(); updatePins(sch, tripInfo(sch)); updateRoute(sch);
  }
  function unit() { const svg = $('#mapsvg'); const w = svg ? svg.clientWidth || 360 : 360, h = svg ? svg.clientHeight || 500 : 500; return Math.max(UI.vb.w / w, UI.vb.h / h); }
  function updateMap(sch, ti) {
    const gp = $('#g-pref'); if (!gp) return;
    if (UI.geo && !gp.childElementCount) initGeoPaths();
    gp.querySelectorAll('path').forEach((p) => {
      const v = prefPct(p.dataset.code);
      p.setAttribute('style', v ? 'fill:var(--road-soft);fill:color-mix(in srgb,var(--road) ' + Math.round(8 + v * 55) + '%,var(--land))' : 'fill:var(--land)');
    });
    updateRoute(sch); updatePins(sch, ti);
  }
  function initGeoPaths() { $('#g-pref').innerHTML = Object.keys(UI.geo).filter((k) => UI.geo[k]).map((k) => '<path data-code="' + k + '" d="' + UI.geo[k] + '" fill="var(--land)" stroke="var(--line)" stroke-width="1" stroke-linejoin="round"/>').join(''); }
  function updateRoute(sch) {
    const g = $('#g-route'); if (!g) return; const u = unit();
    let h = '';
    const pts = sch.filter((s) => typeof s.lat === 'number');
    for (let i = 1; i <= pts.length; i++) {
      const a = pts[i - 1], b = i < pts.length ? pts[i] : pts[0];
      const mode = i < pts.length ? (b.arrive || 'car') : 'home';
      if (mode === 'home' && pts.length < 2) continue;
      const sty = mode === 'home' ? 'stroke="var(--muted)" stroke-width="' + (1.4 * u) + '" stroke-dasharray="' + (4 * u) + ' ' + (4 * u) + '" opacity=".7"'
        : mode === 'ship' ? 'stroke="var(--ship)" stroke-width="' + (2.6 * u) + '" stroke-dasharray="' + (7 * u) + ' ' + (5 * u) + '"'
        : mode === 'plane' ? 'stroke="var(--plane)" stroke-width="' + (2.2 * u) + '" stroke-dasharray="' + (1 * u) + ' ' + (5 * u) + '" stroke-linecap="round"'
        : 'stroke="var(--road)" stroke-width="' + (3 * u) + '" stroke-linecap="round"';
      h += '<line x1="' + PX(a.lng).toFixed(1) + '" y1="' + PY(a.lat).toFixed(1) + '" x2="' + PX(b.lng).toFixed(1) + '" y2="' + PY(b.lat).toFixed(1) + '" ' + sty + ' fill="none"/>';
    }
    g.innerHTML = h;
  }
  function updatePins(sch, ti) {
    const g = $('#g-pin'); if (!g) return; const u = unit();
    const showNum = u < 1.0, showName = u < 0.42;
    const r = (showNum ? 9 : 5) * u;
    g.innerHTML = sch.filter((s) => typeof s.lat === 'number').map((s) => {
      const x = PX(s.lng), y = PY(s.lat);
      const past = ti.t >= s.end, now = ti.cur && ti.cur.id === s.id, sel = UI.sel === s.id;
      const c = REG[s.region] ? REG[s.region][1] : '#555';
      const rr = (s.kind === 'B' ? r : r * 0.72) * (sel || now ? 1.35 : 1);
      return '<g data-pin="' + esc(s.id) + '" style="cursor:pointer"><title>' + esc((s.idx + 1) + '. ' + s.place + '（' + md(s.start) + '〜・' + s.nights + '泊）') + '</title>' +
        '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (Math.max(rr, 11 * u)).toFixed(2) + '" fill="transparent"/>' +
        (now || sel ? '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (rr + 4 * u).toFixed(2) + '" fill="none" stroke="var(--ink)" stroke-width="' + (2 * u) + '"/>' : '') +
        '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + rr.toFixed(2) + '" fill="' + (past ? 'var(--muted)' : c) + '" stroke="var(--land)" stroke-width="' + (1.6 * u) + '"/>' +
        (showNum ? '<text x="' + x.toFixed(1) + '" y="' + (y + 3.6 * u).toFixed(1) + '" text-anchor="middle" font-size="' + (10 * u).toFixed(2) + '" font-family="Inter,sans-serif" font-weight="700" fill="#fff" pointer-events="none">' + (s.idx + 1) + '</text>' : '') +
        (showName ? '<text class="pin-label" x="' + (x + rr + 4 * u).toFixed(1) + '" y="' + (y + 4.5 * u).toFixed(1) + '" font-size="' + (13 * u).toFixed(2) + '" stroke-width="' + (3 * u).toFixed(2) + '" fill="var(--ink)" pointer-events="none">' + esc(s.place) + '</text>' : '') +
        '</g>';
    }).join('');
  }

  // ---------- 行程 ----------
  function vPlan(sch, ti) {
    if (!S.loaded.stops) return '<div class="empty">行程を読み込んでいます</div>';
    const total = ti.total;
    // 同じ地方が続く所をひとまとまりにする（一周すると同じ地方を2回通ることがあるため）
    const runs = []; sch.forEach((st) => { const last = runs[runs.length - 1]; if (last && last.region === st.region) { last.list.push(st); last.nights += (+st.nights || 0); } else runs.push({ region: st.region, list: [st], nights: +st.nights || 0 }); });
    const rc = (r) => (REG[r] ? REG[r][1] : '#666'), rn = (r) => (REG[r] ? REG[r][0] : 'その他');
    let h = '<section class="card" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="sec-h"><h2>行程</h2><p class="sub num">' + sch.length + 'か所・' + total + '泊・' + mdw(ti.start) + '〜' + mdw(ti.end) + '</p></div>' +
      '<div class="grid2"><label class="f">出発日<input class="i" type="date" id="trip-start" value="' + esc(S.trip.start) + '"' + (can() ? '' : ' disabled') + '></label>' +
      '<div class="f">帰着日<div class="i num" style="display:flex;align-items:center">' + mdw(ti.end) + '</div></div></div>' +
      '<p class="sub">出発日や泊数を変えると、後ろの日付がすべて自動でずれます</p>' +
      (runs.length ? '<div class="band" role="group" aria-label="地方ごとの泊数">' + runs.map((r, i) => r.nights ? '<button style="flex:' + r.nights + ';background:' + rc(r.region) + '" data-jump="' + i + '" aria-label="' + esc((i + 1) + '. ' + rn(r.region) + ' ' + r.nights + '泊') + '">' + (r.nights >= 8 ? (i + 1) : '') + '</button>' : '').join('') + '</div>' : '') +
      (runs.length ? '<div class="row" style="font-size:12px;color:var(--muted);gap:12px"><span>帯の色（地方）:</span>' + [...new Set(runs.map((r) => r.region))].map((r) => '<span><i class="lg" style="background:' + rc(r) + '"></i> ' + esc(rn(r)) + '</span>').join('') + '</div>' : '') +
      '<div class="row" style="font-size:12px;color:var(--muted);gap:12px"><span>丸の色（泊まり方・1つ1泊）:</span>' + Object.keys(LODG).map((k) => '<span><i class="lg" style="background:' + LODG[k] + '"></i> ' + k + '</span>').join('') + '</div>' +
      '<button class="btn" id="plan-add"' + (can() ? '' : ' disabled') + '>＋ 泊まる場所を最後に追加</button></section>';
    if (!sch.length) return h + '<div class="empty">行程がまだありません。上の「＋ 泊まる場所を最後に追加」から1件目を作ってください</div>';
    runs.forEach((run, ri) => {
      const list = run.list;
      h += '<div class="reg-h" id="reg-' + ri + '"><span class="reg-n" style="background:' + rc(run.region) + '">' + (ri + 1) + '</span><h2 class="grow">' + esc(rn(run.region)) + '</h2><span class="sub num">' + run.nights + '泊</span></div>';
      list.forEach((s) => {
        const now = ti.cur && ti.cur.id === s.id;
        const first = s.idx === 0, last = s.idx === sch.length - 1;
        h += '<div class="stop-row"><button class="stop' + (now ? ' now' : '') + '" data-edit-stop="' + esc(s.id) + '"><div class="d"><b>' + md(s.start) + '</b>' + WD[s.start.getDay()] + '曜<br>' + (+s.nights || 0) + '泊</div>' +
          '<div style="min-width:0"><div class="t"><strong>' + esc(s.place) + '</strong><span class="sub">' + esc(s.pref) + '</span><span class="pill' + (s.kind === 'B' ? ' base' : '') + '">' + (KIND[s.kind] || '') + '</span>' +
          '<span class="pill ' + esc(s.booking || 'none') + '">' + (BOOK[s.booking] || '未予約') + '</span>' +
          '<span class="nights" aria-label="' + esc(s.lodging) + '">' + Array.from({ length: Math.min(+s.nights || 0, 10) }, () => '<i style="background:' + (LODG[s.lodging] || '#999') + '"></i>').join('') + '</span></div>' +
          (s.what ? '<p class="w">' + esc(s.what) + '</p>' : '') + (s.memo ? '<p class="w" style="color:var(--ink)">メモ: ' + esc(s.memo) + '</p>' : '') + '</div></button>' +
          (can() ? '<div class="mv"><button data-move="' + esc(s.id) + '|-1" aria-label="' + esc(s.place) + 'を1つ前へ"' + (first ? ' disabled' : '') + '>↑</button><button data-move="' + esc(s.id) + '|1" aria-label="' + esc(s.place) + 'を1つ後ろへ"' + (last ? ' disabled' : '') + '>↓</button></div>' : '') + '</div>';
      });
    });
    return h;
  }
  async function moveStop(id, dir) {
    const sch = schedule(); const i = sch.findIndex((x) => x.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= sch.length) return;
    const a = sch[i], b = sch[j];
    let oa = +a.order || 0, ob = +b.order || 0;
    if (oa === ob) { ob = oa + dir; }
    try { await Promise.all([S.db.doc('stops/' + a.id).update({ order: ob }), S.db.doc('stops/' + b.id).update({ order: oa })]); toast(a.place + 'を' + (dir < 0 ? '1つ前' : '1つ後ろ') + 'にしました'); } catch (er) { fail(er); }
  }
  // 位置を決める小さな地図。押した所にピンを置く。指でずらし、＋−で拡大
  function mountPicker(el, pos, onPick) {
    const vb = { w: 320, h: 260 }; vb.x = PX(pos.lng) - vb.w / 2; vb.y = PY(pos.lat) - vb.h / 2;
    el.innerHTML = '<div class="row" style="margin-top:8px"><input class="i grow" id="pk-q" placeholder="地名や住所で探す（例: 函館山）" aria-label="地名や住所で探す"><button type="button" class="btn" id="pk-go">探す</button></div><div id="pk-res" class="pk-res"></div>' +
      '<div class="picker"><svg viewBox="0 0 1 1" role="img" aria-label="位置を決める地図。押した所が泊まる場所になります"><g class="pk-pref"></g><g class="pk-pin"></g></svg>' +
      '<div class="map-tools"><button type="button" data-pz="in" aria-label="拡大">＋</button><button type="button" data-pz="out" aria-label="縮小">−</button></div></div>' +
      '<p class="sub">地図を押すと、その場所にピンが動きます。指でずらして探せます</p>';
    const svg = el.querySelector('svg');
    if (UI.geo) el.querySelector('.pk-pref').innerHTML = Object.keys(UI.geo).filter((k) => UI.geo[k]).map((k) => '<path d="' + UI.geo[k] + '" fill="var(--land)" stroke="var(--line)" stroke-width="0.6" stroke-linejoin="round"/>').join('');
    const pin = () => { const u = vb.w / (svg.clientWidth || 320); el.querySelector('.pk-pin').innerHTML = '<circle cx="' + PX(pos.lng) + '" cy="' + PY(pos.lat) + '" r="' + (8 * u) + '" fill="var(--warm)" stroke="var(--land)" stroke-width="' + (2 * u) + '"/>'; };
    const apply = () => { svg.setAttribute('viewBox', [vb.x, vb.y, vb.w, vb.h].map((n) => n.toFixed(2)).join(' ')); pin(); };
    let down = null, moved = false;
    svg.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; moved = false; });
    svg.addEventListener('pointermove', (e) => {
      if (!down) return; const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      if (!moved) { moved = true; try { svg.setPointerCapture(e.pointerId); } catch (er) {} }
      const k = Math.max(vb.w / svg.clientWidth, vb.h / svg.clientHeight); vb.x -= dx * k; vb.y -= dy * k; down = { x: e.clientX, y: e.clientY }; apply();
    });
    svg.addEventListener('pointerup', (e) => {
      if (down && !moved) {
        const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        const p = pt.matrixTransform(svg.getScreenCTM().inverse());
        pos = { lat: Math.round((45.8 - p.y / 100) * 10000) / 10000, lng: Math.round((p.x / (COS * 100) + 122.5) * 10000) / 10000 };
        onPick(pos); pin();
      }
      down = null;
    });
    // 国土地理院の住所検索（無料・キー不要）。結果を押すと、その場所にピンを移す
    const search = async () => {
      const q = el.querySelector('#pk-q').value.trim(); const res = el.querySelector('#pk-res'); if (!q) return;
      res.innerHTML = '<p class="sub">探しています</p>';
      try {
        const r = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q));
        const list = (await r.json()).slice(0, 8);
        if (!list.length) { res.innerHTML = '<p class="sub">見つかりませんでした。別の言い方で探すか、地図を押して決めてください</p>'; return; }
        res.innerHTML = list.map((f, i) => '<button type="button" class="pk-hit" data-hit="' + i + '">' + esc(f.properties && f.properties.title) + '</button>').join('');
        res.querySelectorAll('[data-hit]').forEach((b) => b.addEventListener('click', () => {
          const f = list[+b.dataset.hit]; const [lng, lat] = f.geometry.coordinates;
          pos = { lat: Math.round(lat * 10000) / 10000, lng: Math.round(lng * 10000) / 10000 };
          vb.w = 120; vb.h = vb.w * 260 / 320; vb.x = PX(pos.lng) - vb.w / 2; vb.y = PY(pos.lat) - vb.h / 2; apply();
          onPick(pos, f.properties && f.properties.title); res.innerHTML = '';
        }));
      } catch (er) { res.innerHTML = '<p class="sub">探せませんでした。電波のある所でもう一度試すか、地図を押して決めてください</p>'; }
    };
    el.querySelector('#pk-go').addEventListener('click', search);
    el.querySelector('#pk-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    el.querySelectorAll('[data-pz]').forEach((b) => b.addEventListener('click', () => {
      const f = b.dataset.pz === 'in' ? 0.6 : 1.6; const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
      vb.w = Math.min(Math.max(vb.w * f, 30), 2000); vb.h = vb.w * 260 / 320; vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2; apply();
    }));
    apply();
  }
  function stopSheet(id, insertAfter) {
    const sch = schedule();
    const s = id ? sch.find((x) => x.id === id) : null;
    const atEnd = !s && !insertAfter;
    const ref = insertAfter || sch[sch.length - 1] || null;
    const base = s || { place: '', pref: '', nights: 1, kind: 'T', lodging: '車中泊', lodgingName: '', booking: 'none', cost: 0, what: '', memo: '', region: ref ? ref.region : 0, arrive: 'car',
      lat: ref ? ref.lat : 36.2, lng: ref ? ref.lng : 138.25 };
    let pos = { lat: typeof base.lat === 'number' ? base.lat : 36.2, lng: typeof base.lng === 'number' ? base.lng : 138.25 };
    let posChanged = false;
    const title = s ? (s.idx + 1) + '. ' + s.place : '泊まる場所を追加';
    const where = s ? '<p class="sub">' + mdw(s.start) + '〜' + mdw(s.end) + '</p>' : (atEnd ? '<p class="sub">行程の最後に入ります</p>' : '<p class="sub">「' + esc(insertAfter.place) + '」のあとに入ります</p>');
    openSheet('<h2>' + esc(title) + '</h2>' + where +
      '<form id="stop-form" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="grid2"><label class="f">泊まる場所<input class="i" id="sf-place" required value="' + esc(base.place) + '"></label><label class="f">都道府県<select class="i" id="sf-pref"><option value="">選んでください</option>' + PREFS.map((x) => '<option' + (base.pref === x ? ' selected' : '') + '>' + x + '</option>').join('') + (base.pref && !PREFS.includes(base.pref) ? '<option selected>' + esc(base.pref) + '</option>' : '') + '</select></label></div>' +
      '<div class="f">地図上の位置<div class="row"><span class="grow num" id="sf-pos" style="font-size:13px;color:var(--muted)">' + (s && typeof s.lat === 'number' ? '北緯' + pos.lat.toFixed(2) + '・東経' + pos.lng.toFixed(2) : '保存するときに、場所の名前と都道府県から自動で決めます') + '</span>' + '<button class="btn small" type="button" id="sf-regeo">名前から探し直す</button><button class="btn small" type="button" id="sf-pick">地図で位置を決める</button></div><div id="sf-map"></div></div>' +
      '<div class="grid2"><label class="f">ここへの移動<select class="i" id="sf-arrive">' + [['car', '車'], ['ship', '船'], ['plane', '飛行機']].map((x) => '<option value="' + x[0] + '"' + ((base.arrive || 'car') === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') + '</select></label>' +
      '<label class="f">地方<select class="i" id="sf-region">' + REG.map((r, i) => '<option value="' + i + '"' + (+base.region === i ? ' selected' : '') + '>' + esc(r[0]) + '</option>').join('') + '</select></label></div>' +
      '<div class="grid2"><label class="f">泊数<input class="i num" id="sf-nights" type="number" inputmode="numeric" min="0" max="' + MAX_NIGHTS + '" value="' + (+base.nights || 0) + '"></label>' +
      '<label class="f">種類<select class="i" id="sf-kind">' + Object.keys(KIND).map((k) => '<option value="' + k + '"' + (base.kind === k ? ' selected' : '') + '>' + KIND[k] + '</option>').join('') + '</select></label></div>' +
      '<div class="grid2"><label class="f">泊まり方<select class="i" id="sf-lodging">' + Object.keys(LODG).map((k) => '<option' + (base.lodging === k ? ' selected' : '') + '>' + k + '</option>').join('') + (base.lodging && !LODG[base.lodging] ? '<option selected>' + esc(base.lodging) + '</option>' : '') + '</select></label>' +
      '<label class="f">予約<select class="i" id="sf-booking">' + Object.keys(BOOK).map((k) => '<option value="' + k + '"' + ((base.booking || 'none') === k ? ' selected' : '') + '>' + BOOK[k] + '</option>').join('') + '</select></label></div>' +
      '<div class="grid2"><label class="f">宿・キャンプ場の名前<input class="i" id="sf-lname" value="' + esc(base.lodgingName) + '"></label><label class="f">宿代（合計・円）<input class="i num" id="sf-cost" type="number" inputmode="numeric" min="0" value="' + (+base.cost || '') + '"></label></div>' +
      (s ? '<div id="auto-box">' + autoBox('stop', s) + '</div>' : '<p class="sub">保存したあと、支払い済みにして宿代を入れると、お金の出費に記録できます</p>') +
      '<label class="f">回る所<textarea class="i" id="sf-what">' + esc(base.what) + '</textarea></label>' +
      '<label class="f">メモ<textarea class="i" id="sf-memo" placeholder="予約番号、チェックイン時間など">' + esc(base.memo) + '</textarea></label>' +
      '<div class="row"><button class="btn primary grow" type="submit"' + (can() ? '' : ' disabled') + '>保存</button><button class="btn" type="button" data-close>閉じる</button></div>' +
      (s ? '<div class="row"><button class="btn small" type="button" id="sf-add">この後に泊まる場所を追加</button><span class="grow"></span><button class="btn small danger" type="button" id="sf-del"' + (can() ? '' : ' disabled') + '>この泊まりを消す</button></div><div id="sf-confirm"></div>' : '') +
      '</form>');
    $('#sf-pick').addEventListener('click', () => {
      const box = $('#sf-map');
      if (box.innerHTML) { box.innerHTML = ''; $('#sf-pick').textContent = '地図で位置を決める'; return; }
      $('#sf-pick').textContent = '地図を閉じる';
      mountPicker(box, pos, (p, title) => {
        pos = p; posChanged = true; $('#sf-pos').textContent = '北緯' + p.lat.toFixed(2) + '・東経' + p.lng.toFixed(2) + '（保存すると反映）';
        if (title) {
          const pref = PREFS.find((x) => title.startsWith(x));
          if (pref && !$('#sf-pref').value) $('#sf-pref').value = pref;
          const rg = regionOfPref(title); if (rg >= 0) $('#sf-region').value = String(rg);
          if (!$('#sf-place').value.trim()) $('#sf-place').value = title.replace(/^(北海道|東京都|大阪府|京都府|.{2,3}県)/, '');
        }
      });
    });
    $('#sf-regeo').addEventListener('click', async () => {
      const place = $('#sf-place').value.trim(), pref = $('#sf-pref').value;
      if (!place) { toast('先に泊まる場所の名前を入れてください'); return; }
      $('#sf-pos').textContent = '探しています';
      const g = await geocode(place, pref);
      if (g) { pos = g; posChanged = true; $('#sf-pos').textContent = '北緯' + g.lat.toFixed(2) + '・東経' + g.lng.toFixed(2) + '（保存すると反映）'; }
      else $('#sf-pos').textContent = (pref ? pref + 'で' : '') + '「' + place + '」が見つかりませんでした。「地図で位置を決める」で決めてください';
    });
    $('#sf-pref').addEventListener('change', () => { const rg = regionOfPref($('#sf-pref').value); if (rg >= 0) $('#sf-region').value = String(rg); });
    $('#stop-form').addEventListener('submit', async (e) => {
      e.preventDefault(); if (!can()) return;
      const data = { place: $('#sf-place').value.trim(), pref: $('#sf-pref').value.trim(), nights: Math.max(0, Math.min(MAX_NIGHTS, parseInt($('#sf-nights').value, 10) || 0)),
        kind: $('#sf-kind').value, lodging: $('#sf-lodging').value, booking: $('#sf-booking').value, lodgingName: $('#sf-lname').value.trim(),
        cost: Math.max(0, parseInt($('#sf-cost').value, 10) || 0), what: $('#sf-what').value.trim(), memo: $('#sf-memo').value.trim(),
        arrive: $('#sf-arrive').value, region: parseInt($('#sf-region').value, 10) || 0 };
      // 地図で決めていないときは、名前か都道府県が変わった（または新しく作った）ときに位置を探し直す
      let posNote = '';
      if (posChanged) { data.lat = pos.lat; data.lng = pos.lng; }
      else if (!s || data.place !== s.place || data.pref !== s.pref || typeof s.lat !== 'number') {
        const g = data.place ? await geocode(data.place, data.pref) : null;
        const pi = PREFS.indexOf(data.pref);
        if (g) { data.lat = g.lat; data.lng = g.lng; posNote = '位置は「' + data.place + '」で探して決めました'; }
        else if (pi >= 0) { data.lat = PREF_POS[pi][0]; data.lng = PREF_POS[pi][1]; posNote = '場所が見つからなかったので、' + data.pref + 'の県庁のあたりに置きました。「地図で位置を決める」で直せます'; }
        else if (!s) { data.lat = pos.lat; data.lng = pos.lng; posNote = '位置が決まっていません。「地図で位置を決める」で決めてください'; }
      }
      try {
        let sid;
        if (s) { sid = s.id; await S.db.doc('stops/' + s.id).update(data); }
        else {
          let order;
          if (atEnd) order = ref ? (+ref.order || 0) + 10 : 10;
          else { const i = sch.findIndex((x) => x.id === insertAfter.id); const nx = sch[i + 1]; order = nx ? (insertAfter.order + nx.order) / 2 : insertAfter.order + 10; }
          const r = await S.db.collection('stops').add({ ...data, order }); sid = r.id;
        }
        closeSheet(); toast(posNote ? '保存しました。' + posNote : '保存しました');
        // 予約の欄で支払い済みにした（または外した）ときも、状態を切り替えたときと同じように出費のことを聞く
        if (data.booking !== (s ? s.booking || 'none' : 'none')) askAuto('stop', sid, data.booking, data.place + 'の宿代');
      } catch (er) { fail(er); }
    });
    if (s) {
      $('#sf-add').addEventListener('click', () => stopSheet(null, s));
      $('#sf-del').addEventListener('click', () => {
        $('#sf-confirm').innerHTML = '<div class="banner row"><span class="grow">「' + esc(s.place) + '」を行程から消します。後ろの日付が' + (+s.nights || 0) + '日早まります' + (S.expenses.some((x) => x.id === 'auto-s-' + s.id) ? '。出費に記録した宿代は残ります。不要なら「出費から外す」を先に押してください' : '') + '</span><button class="btn small danger" type="button" id="sf-del2">消す</button></div>';
        $('#sf-del2').addEventListener('click', async () => { try { await S.db.doc('stops/' + s.id).delete(); closeSheet(); UI.sel = null; toast('消しました'); } catch (er) { fail(er); } });
      });
    }
  }

  // ---------- 予約 ----------
  function vBook(sch) {
    const stays = sch.filter((s) => s.kind !== 'S' && !OUTDOOR.includes(s.lodging));
    const camps = sch.filter((s) => OUTDOOR.includes(s.lodging));
    const when = (b) => { if (b.date) return parseD(b.date).getTime(); const s = sch.find((x) => x.id === b.stopId); return s ? s.start.getTime() : 0; };
    const others = S.bookings.slice().sort((a, b) => (when(a) - when(b)) || ((a.order || 0) - (b.order || 0)));
    const all = [...stays.map((s) => s.booking || 'none'), ...others.map((b) => b.status || 'none')];
    const cnt = { none: 0, booked: 0, paid: 0 }; all.forEach((k) => { cnt[k] = (cnt[k] || 0) + 1; });
    const f = UI.bookFilter;
    const pass = (st) => f === 'all' || (st || 'none') === f;
    let h = '<section class="card" style="display:flex;flex-direction:column;gap:12px"><div class="sec-h"><h2>予約</h2><p class="sub num">全' + all.length + '件</p></div>' +
      '<div class="band" aria-hidden="true">' + ['paid', 'booked', 'none'].map((k) => cnt[k] ? '<span style="flex:' + cnt[k] + ';background:' + (k === 'paid' ? 'var(--ok)' : k === 'booked' ? 'var(--road)' : 'var(--warm-soft)') + '"></span>' : '').join('') + '</div>' +
      '<div class="row" style="gap:16px;font-size:13px">' + ['none', 'booked', 'paid'].map((k) => '<span><span class="pill ' + k + '">' + BOOK[k] + '</span> <b class="num">' + cnt[k] + '</b></span>').join('') + '</div>' +
      '<div class="chips" role="group" aria-label="絞り込み">' + [['all', 'すべて'], ['none', '未予約'], ['booked', '予約済み'], ['paid', '支払い済み']].map((x) => '<button class="chip" data-bf="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' + x[1] + '</button>').join('') + '</div></section>';
    h += '<section class="card"><div class="sec-h"><h3>移動・見学・体験</h3><button class="btn small" id="bk-add"' + (can() ? '' : ' disabled') + '>＋ 追加</button></div>';
    const ol = others.filter((b) => pass(b.status));
    h += ol.length ? ol.map((b) => {
      const s = sch.find((x) => x.id === b.stopId);
      return '<div class="wish" style="align-items:center"><div class="grow"><div class="n">' + esc(b.title) + '</div><div class="d">' + esc(b.kind) + (b.date ? '・' + mdw(parseD(b.date)) : '') + (s ? '・' + md(s.start) + '〜' + md(s.end) + '（' + esc(s.place) + '）' : '') + (b.amount ? '・' + yen(b.amount) : '') + '</div>' + (b.memo ? '<div class="d">' + esc(b.memo) + '</div>' : '') + '</div>' +
        '<button class="pill ' + esc(b.status || 'none') + '" style="border:0;min-height:36px;padding:0 10px" data-cycle-b="' + esc(b.id) + '" aria-label="' + esc(b.title) + 'の状態を切り替え">' + (BOOK[b.status] || '未予約') + '</button>' +
        '<button class="btn small" data-edit-b="' + esc(b.id) + '" aria-label="' + esc(b.title) + 'を編集">編集</button></div>';
    }).join('') : '<div class="empty" style="margin-top:10px">' + (S.loaded.bookings ? '該当する予約はありません' : '読み込んでいます') + '</div>';
    h += '</section>';
    const listStay = (title, arr) => {
      const l = arr.filter((s) => pass(s.booking));
      return '<section class="card"><div class="sec-h"><h3>' + title + '</h3><span class="sub num">' + arr.length + 'か所</span></div>' +
        (l.length ? l.map((s) => '<div class="wish" style="align-items:center"><div class="grow"><div class="n">' + md(s.start) + '〜 ' + esc(s.place) + '（' + (+s.nights || 0) + '泊）</div><div class="d">' + esc(s.lodging) + (s.lodgingName ? '・' + esc(s.lodgingName) : '・宿の名前は未入力') + (s.cost ? '・' + yen(s.cost) : '') + '</div></div>' +
          '<button class="pill ' + esc(s.booking || 'none') + '" style="border:0;min-height:36px;padding:0 10px" data-cycle-s="' + esc(s.id) + '" aria-label="' + esc(s.place) + 'の予約の状態を切り替え">' + (BOOK[s.booking] || '未予約') + '</button>' +
          '<button class="btn small" data-edit-stop="' + esc(s.id) + '" aria-label="' + esc(s.place) + 'を編集">編集</button></div>').join('') : '<div class="empty" style="margin-top:10px">該当するものはありません</div>') + '</section>';
    };
    h += listStay('宿', stays) + listStay('車中泊・テント泊の場所（RVパーク・キャンプ場）', camps);
    return h;
  }
  const nextStatus = (s) => ({ none: 'booked', booked: 'paid', paid: 'none' }[s || 'none']);
  function bookingSheet(id) {
    const b = id ? S.bookings.find((x) => x.id === id) : { title: '', kind: 'その他', stopId: '', status: 'none', amount: 0, memo: '' };
    if (!b) return;
    const sch = schedule();
    openSheet('<h2>' + (id ? '予約を編集' : '予約を追加') + '</h2><form id="bk-form" style="display:flex;flex-direction:column;gap:12px">' +
      '<label class="f">名前<input class="i" id="bf-title" required value="' + esc(b.title) + '" placeholder="例: 青函フェリー"></label>' +
      '<div class="grid2"><label class="f">種類<select class="i" id="bf-kind">' + BKIND.map((k) => '<option' + (b.kind === k ? ' selected' : '') + '>' + k + '</option>').join('') + '</select></label>' +
      '<label class="f">状態<select class="i" id="bf-status">' + Object.keys(BOOK).map((k) => '<option value="' + k + '"' + ((b.status || 'none') === k ? ' selected' : '') + '>' + BOOK[k] + '</option>').join('') + '</select></label></div>' +
      '<div class="grid2"><label class="f">日付（なくてもよい）<input class="i" id="bf-date" type="date" value="' + esc(b.date || '') + '"></label>' +
      '<label class="f">どの泊まりのときか<select class="i" id="bf-stop"><option value="">決めない</option>' + sch.map((s) => '<option value="' + esc(s.id) + '"' + (b.stopId === s.id ? ' selected' : '') + '>' + md(s.start) + '〜 ' + esc(s.place) + '</option>').join('') + '</select></label></div>' +
      '<p class="sub">日付は、出発前の支払いや予約の受付開始日など、泊まる場所と関係ないときに入れてください</p>' +
      '<label class="f">金額（円）<input class="i num" id="bf-amount" type="number" inputmode="numeric" min="0" value="' + (+b.amount || '') + '"></label>' +
      (id ? '<div id="auto-box">' + autoBox('booking', b) + '</div>' : '<p class="sub">保存したあと、支払い済みにして金額を入れると、お金の出費に記録できます</p>') +
      '<label class="f">メモ<textarea class="i" id="bf-memo" placeholder="予約番号、受付の開始日など">' + esc(b.memo) + '</textarea></label>' +
      '<div class="row"><button class="btn primary grow" type="submit"' + (can() ? '' : ' disabled') + '>保存</button><button class="btn" type="button" data-close>閉じる</button></div>' +
      (id ? '<div class="row"><span class="grow"></span><button class="btn small danger" type="button" id="bf-del">この予約を消す</button></div><div id="bf-confirm"></div>' : '') + '</form>');
    $('#bk-form').addEventListener('submit', async (e) => {
      e.preventDefault(); if (!can()) return;
      const data = { title: $('#bf-title').value.trim(), kind: $('#bf-kind').value, status: $('#bf-status').value, stopId: $('#bf-stop').value, date: $('#bf-date').value || '', amount: Math.max(0, parseInt($('#bf-amount').value, 10) || 0), memo: $('#bf-memo').value.trim() };
      try {
        let bid = id;
        if (id) await S.db.doc('bookings/' + id).update(data); else bid = (await S.db.collection('bookings').add({ ...data, order: Date.now() })).id;
        closeSheet(); toast('保存しました');
        if (data.status !== (id ? b.status || 'none' : 'none')) askAuto('booking', bid, data.status, data.title);
      } catch (er) { fail(er); }
    });
    if (id) $('#bf-del').addEventListener('click', () => {
      $('#bf-confirm').innerHTML = '<div class="banner row"><span class="grow">「' + esc(b.title) + '」を消します' + (S.expenses.some((x) => x.id === 'auto-b-' + id) ? '。出費に記録した分は残ります。不要なら「出費から外す」を先に押してください' : '') + '</span><button class="btn small danger" type="button" id="bf-del2">消す</button></div>';
      $('#bf-del2').addEventListener('click', async () => { try { await S.db.doc('bookings/' + id).delete(); closeSheet(); toast('消しました'); } catch (er) { fail(er); } });
    });
  }

  // ---------- 予約と出費のつながり ----------
  // 自動では反映しない。「出費に記録する」「出費から外す」を押したときだけ動く。
  // 出費のIDは元の予約から決まるので、何度押しても二重にならない
  const KIND2CAT = { '宿': '宿泊', '飛行機': '交通', '船': '交通', 'レンタカー': '交通', '駐車場': '交通', '見学・体験': '観光・体験', 'その他': 'その他' };
  const autoId = (type, id) => (type === 'stop' ? 'auto-s-' : 'auto-b-') + id;
  function autoSrc(type, id) { return type === 'stop' ? S.stops.find((x) => x.id === id) : S.bookings.find((x) => x.id === id); }
  function autoAmount(type, o) { return o ? +(type === 'stop' ? o.cost : o.amount) || 0 : 0; }
  function autoPaid(type, o) { return o ? (type === 'stop' ? o.booking : o.status) === 'paid' : false; }
  function autoBox(type, o) {
    if (!o || !o.id) return '';
    const ex = S.expenses.find((x) => x.id === autoId(type, o.id));
    const amt = autoAmount(type, o), key = type + '|' + o.id;
    if (ex) {
      return '<div class="link-box"><div class="row"><span class="grow">出費に記録済み <b class="num">' + yen(ex.amount) + '</b>（' + esc(ex.date ? md(parseD(ex.date)) : '') + '）</span>' +
        '<button class="btn small" type="button" data-auto-un="' + esc(key) + '">出費から外す</button></div>' +
        (amt > 0 && amt !== +ex.amount ? '<div class="row"><span class="grow" style="color:var(--warm);font-weight:700">今の金額 ' + yen(amt) + ' と違います</span><button class="btn small" type="button" data-auto-rec="' + esc(key) + '">今の金額で記録し直す</button></div>' : '') + '</div>';
    }
    if (autoPaid(type, o) && amt > 0) return '<div class="link-box"><div class="row"><span class="grow">まだ出費に入っていません</span><button class="btn small primary" type="button" data-auto-rec="' + esc(key) + '">出費に記録する（' + yen(amt) + '）</button></div></div>';
    if (amt > 0) return '<p class="sub">支払い済みにすると、お金の出費に記録できます（金額を変えたときは先に保存してください）</p>';
    return '<p class="sub">金額を入れて支払い済みにすると、お金の出費に記録できます</p>';
  }
  async function recordAuto(type, id) {
    if (!can()) return; const o = autoSrc(type, id); if (!o) return;
    const amt = autoAmount(type, o); if (!(amt > 0)) { toast('先に金額を入れて保存してください'); return; }
    let data;
    if (type === 'stop') { const st = schedule().find((x) => x.id === id); data = { amount: amt, cat: '宿泊', date: st ? iso(st.start) : iso(today()), memo: (o.place || '') + 'の宿代', src: 'stops/' + id, at: Date.now(), by: S.me || '' }; }
    else { const st = o.stopId ? schedule().find((x) => x.id === o.stopId) : null; data = { amount: amt, cat: KIND2CAT[o.kind] || 'その他', date: o.date || (st ? iso(st.start) : iso(today())), memo: o.title || '予約', src: 'bookings/' + id, at: Date.now(), by: S.me || '' }; }
    try { await S.db.doc('expenses/' + autoId(type, id)).set(data); toast(yen(amt) + 'を出費に記録しました'); } catch (er) { fail(er); }
  }
  async function unrecordAuto(type, id) {
    if (!can()) return;
    try { await S.db.doc('expenses/' + autoId(type, id)).delete(); toast('出費から外しました'); } catch (er) { fail(er); }
  }
  // 状態を切り替えたあとに、出費に記録するか（外すか）を聞く
  function askAuto(type, id, status, label) {
    const o = autoSrc(type, id); const amt = autoAmount(type, o);
    const has = S.expenses.some((x) => x.id === autoId(type, id));
    const key = esc(type + '|' + id);
    if (status === 'paid' && amt > 0 && !has) {
      openSheet('<h2>出費にも記録しますか？</h2><p style="margin:0">「' + esc(label) + '」を支払い済みにしました。' + yen(amt) + 'をお金の出費に記録できます。</p>' +
        '<div class="row"><button class="btn primary grow" type="button" data-auto-rec="' + key + '" data-then-close="1">記録する（' + yen(amt) + '）</button><button class="btn" type="button" data-close>今はしない</button></div>');
    } else if (status === 'paid' && !(amt > 0)) {
      toast('支払い済みにしました。金額を入れると出費に記録できます');
    } else if (status !== 'paid' && has) {
      openSheet('<h2>出費から外しますか？</h2><p style="margin:0">「' + esc(label) + '」は支払い済みではなくなりました。出費に記録した分を外せます。</p>' +
        '<div class="row"><button class="btn primary grow" type="button" data-auto-un="' + key + '" data-then-close="1">出費から外す</button><button class="btn" type="button" data-close>そのままにする</button></div>');
    }
  }
  function refreshAutoBox() {
    const box = $('#auto-box'); if (!box) return;
    const btn = box.querySelector('[data-auto-rec],[data-auto-un]'); const key = box.dataset.key || (btn ? (btn.dataset.autoRec || btn.dataset.autoUn) : '');
    if (!key) return; box.dataset.key = key; const [type, id] = key.split('|'); box.innerHTML = autoBox(type, autoSrc(type, id) || { id });
  }

  function expenseSheet(id) {
    const e = S.expenses.find((x) => x.id === id); if (!e) return;
    if (e.src && autoSrc(String(e.src).startsWith('stops/') ? 'stop' : 'booking', String(e.src).split('/')[1])) {
      const isStop = String(e.src).startsWith('stops/'), sid = String(e.src).split('/')[1];
      openSheet('<h2>' + esc(e.memo || e.cat) + '</h2><p class="sub num">' + mdw(parseD(e.date)) + '・' + esc(e.cat) + '・' + yen(e.amount) + '</p>' +
        '<p class="banner">' + (isStop ? '泊まる場所の宿代' : '予約') + 'から記録した出費です。金額は元の' + (isStop ? '泊まる場所' : '予約') + 'で直してから、そこで「今の金額で記録し直す」を押してください</p>' +
        '<div class="row"><span class="grow"></span><button class="btn small danger" type="button" data-auto-un="' + (isStop ? 'stop' : 'booking') + '|' + esc(sid) + '">出費から外す</button></div>' +
        '<div class="row"><button class="btn primary grow" type="button" ' + (isStop ? 'data-edit-stop' : 'data-edit-b') + '="' + esc(sid) + '">元の' + (isStop ? '泊まる場所' : '予約') + 'を開く</button><button class="btn" type="button" data-close>閉じる</button></div>');
      return;
    }
    openSheet('<h2>出費を直す</h2><form id="exe-form" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="grid2"><label class="f">金額（円）<input class="i num" id="exe-amt" type="number" inputmode="numeric" min="1" required value="' + (+e.amount || '') + '"></label>' +
      '<label class="f">日付<input class="i" id="exe-date" type="date" value="' + esc(e.date || '') + '"></label></div>' +
      '<label class="f">項目<select class="i" id="exe-cat">' + CATS.map((c) => '<option' + (e.cat === c.k ? ' selected' : '') + '>' + esc(c.k) + '</option>').join('') + '</select></label>' +
      '<label class="f">メモ<input class="i" id="exe-memo" value="' + esc(e.memo || '') + '"></label>' +
      '<div class="row"><button class="btn primary grow" type="submit"' + (can() ? '' : ' disabled') + '>保存</button><button class="btn" type="button" data-close>閉じる</button></div>' +
      '<div class="row"><span class="grow"></span><button class="btn small danger" type="button" id="exe-del"' + (can() ? '' : ' disabled') + '>この出費を消す</button></div><div id="exe-confirm"></div></form>');
    $('#exe-form').addEventListener('submit', async (ev) => {
      ev.preventDefault(); if (!can()) return;
      const amt = parseInt($('#exe-amt').value, 10); if (!amt || amt < 0) { toast('金額を入れてください'); return; }
      try { await S.db.doc('expenses/' + id).update({ amount: amt, date: $('#exe-date').value || e.date, cat: $('#exe-cat').value, memo: $('#exe-memo').value.trim() }); closeSheet(); toast('直しました'); } catch (er) { fail(er); }
    });
    $('#exe-del').addEventListener('click', () => {
      $('#exe-confirm').innerHTML = '<div class="banner row"><span class="grow">' + yen(e.amount) + 'の出費を消します</span><button class="btn small danger" type="button" id="exe-del2">消す</button></div>';
      $('#exe-del2').addEventListener('click', async () => { try { await S.db.doc('expenses/' + id).delete(); closeSheet(); toast('消しました'); } catch (er) { fail(er); } });
    });
  }

  // ---------- お金 ----------
  function budgetOf(cat) { const b = S.budget || {}; return +b[cat] || 0; }
  function vMoney(sch, ti) {
    const ex = S.expenses;
    const spent = ex.reduce((a, e) => a + (+e.amount || 0), 0);
    const totalB = CATS.reduce((a, c) => a + budgetOf(c.b), 0);
    const byCat = {}; ex.forEach((e) => { byCat[e.cat] = (byCat[e.cat] || 0) + (+e.amount || 0); });
    const days = Math.max(ti.total, 1);
    const elapsed = ti.phase === 'before' ? 0 : ti.phase === 'after' ? days : Math.min(days, ti.day);
    const planNow = totalB * elapsed / days;
    const diff = spent - planNow;
    const noBudget = totalB <= 0;
    let h = (noBudget ? '<section class="card" style="display:flex;flex-direction:column;gap:10px;border-color:var(--road)"><h2>まず予算を決めましょう</h2><p style="margin:0">予算を決めると、使いすぎていないかを項目ごとに確かめられます。総額を入れるだけでも始められます。</p><button class="btn primary" id="bud-edit2"' + (can() ? '' : ' disabled') + '>予算を決める</button></section>' : '') + '<section class="card" style="display:flex;flex-direction:column;gap:14px"><div class="sec-h"><h2>お金</h2><button class="btn small" id="bud-edit"' + (can() ? '' : ' disabled') + '>予算を編集</button></div>' +
      '<div class="row" style="align-items:flex-end;gap:20px"><div><p class="sub">使った額</p><div class="big">' + man(spent) + '</div></div><div><p class="sub">予算</p><div class="num" style="font-size:20px;font-weight:700">' + man(totalB) + '</div></div>' +
      '<div><p class="sub">残り</p><div class="num" style="font-size:20px;font-weight:700;color:' + (!noBudget && totalB - spent < 0 ? 'var(--warm)' : 'var(--ink)') + '">' + (noBudget ? '予算なし' : man(totalB - spent)) + '</div></div></div>' +
      (ti.phase === 'during' && !noBudget ? '<p class="sub">今日までの予定は' + man(planNow) + '。' + (diff > 0 ? '<b style="color:var(--warm)">' + man(diff) + '使いすぎ</b>' : '<b style="color:var(--ok)">' + man(-diff) + '余裕あり</b>') + 'です</p>' : (ti.phase === 'before' ? '<p class="sub">出発前です。前払いの予約などもここに記録できます</p>' : '')) +
      '<div style="display:flex;flex-direction:column;gap:10px">' + CATS.map((c) => {
        const b = budgetOf(c.b), v = byCat[c.k] || 0, p = b ? Math.min(100, v / b * 100) : 0;
        return '<div class="cat"><span class="k">' + esc(c.k) + '</span><div class="bar" role="img" aria-label="' + esc(c.k + ' 予算' + man(b) + 'のうち' + man(v)) + '"><b class="' + (b > 0 && v > b ? 'over' : '') + '" style="width:' + p.toFixed(1) + '%"></b></div><span class="v">' + man(v) + ' / ' + man(b) + '</span></div>';
      }).join('') + '</div><p class="sub">「その他」は予備費の予算から使います</p></section>';
    h += '<section class="card" style="display:flex;flex-direction:column;gap:12px"><h3>出費を記録</h3><form id="ex-form" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="grid2"><label class="f">金額（円）<input class="i num" id="ex-amt" type="number" inputmode="numeric" min="1" required placeholder="例: 1800"></label>' +
      '<label class="f">日付<input class="i" id="ex-date" type="date" value="' + iso(ti.phase === 'during' ? ti.t : today()) + '"></label></div>' +
      '<div class="chips" role="radiogroup" aria-label="項目" id="ex-cats">' + CATS.map((c, i) => '<button type="button" class="chip" role="radio" data-cat="' + esc(c.k) + '" aria-pressed="' + (i === 1) + '" aria-checked="' + (i === 1) + '">' + esc(c.k) + '</button>').join('') + '</div>' +
      '<label class="f">メモ<input class="i" id="ex-memo" placeholder="例: 函館朝市の海鮮丼"></label>' +
      '<button class="btn primary" type="submit"' + (can() ? '' : ' disabled') + '>記録する</button></form></section>';
    h += '<section class="card">' + paceChart(sch, ti, totalB) + '</section>';
    const list = ex.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || 0) - (a.at || 0));
    const shown = UI.expAll ? list : list.slice(0, 20);
    h += '<section class="card"><div class="sec-h"><h3>記録した出費</h3><span class="sub num">' + list.length + '件</span></div>' +
      (shown.length ? shown.map((e) => { const d = parseD(e.date); return '<button class="exp" data-edit-ex="' + esc(e.id) + '"><span class="num sub">' + md(d) + '</span><span style="min-width:0;text-align:left"><span style="display:block;font-weight:700">' + esc(e.memo || e.cat) + '</span><span class="sub">' + esc(e.cat) + (e.src ? '・<span class="pill paid">予約から</span>' : '') + '</span></span><span class="num" style="font-weight:700">' + yen(e.amount) + '</span><span class="sub" aria-hidden="true">›</span></button>'; }).join('')
        : '<div class="empty" style="margin-top:10px">まだ記録はありません。上の欄から1件目を記録してください</div>') +
      (list.length > 20 ? '<button class="btn small" id="ex-more" style="margin-top:10px">' + (UI.expAll ? '新しい20件だけ表示' : 'すべて表示') + '</button>' : '') + '</section>';
    return h;
  }
  function paceChart(sch, ti, totalB) {
    const days = Math.max(ti.total, 1), W = 640, H = 220, L = 44, R = 12, T = 16, B = 30;
    const x = (d) => L + (W - L - R) * d / days, y = (v) => T + (H - T - B) * (1 - v / Math.max(totalB, 1));
    const byDay = new Array(days + 1).fill(0); let pre = 0;
    S.expenses.forEach((e) => { const k = dayDiff(ti.start, parseD(e.date)); if (k < 0) pre += +e.amount || 0; else if (k <= days) byDay[k] += +e.amount || 0; });
    const lastDay = ti.phase === 'before' ? -1 : ti.phase === 'after' ? days : Math.min(days, ti.day - 1);
    let acc = pre, pts = [[x(0), y(acc)]];
    for (let d = 0; d <= lastDay; d++) { acc += byDay[d]; pts.push([x(d + 1 > days ? days : d + 1), y(Math.min(acc, totalB * 1.3))]); }
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => totalB * f);
    let svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="予定と実際の出費の累計">';
    ticks.forEach((t) => { svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke="var(--line)" stroke-width="1"/><text x="' + (L - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end" font-size="11" fill="var(--muted)" font-family="Inter,sans-serif">' + Math.round(t / 10000) + '万</text>'; });
    // 月の区切り。旅が長いときは、線が混み合わないように間引く（多くても12本）
    const months = Math.ceil(days / 28) + 1, stepM = Math.max(1, Math.ceil(months / 12));
    for (let m = 0; m <= months; m++) {
      const d0 = new Date(ti.start.getFullYear(), ti.start.getMonth() + m, 1); const k = dayDiff(ti.start, d0);
      if (k > 0 && k < days && d0.getMonth() % stepM === 0) svg += '<line x1="' + x(k) + '" x2="' + x(k) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--line)" stroke-dasharray="3 3"/><text x="' + (x(k) + 3) + '" y="' + (H - 10) + '" font-size="11" fill="var(--muted)">' + (d0.getMonth() + 1) + '月</text>';
    }
    svg += '<line x1="' + x(0) + '" y1="' + y(0) + '" x2="' + x(days) + '" y2="' + y(totalB) + '" stroke="var(--muted)" stroke-width="2" stroke-dasharray="6 5"/>';
    if (pts.length > 1) {
      svg += '<path d="M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L') + 'L' + pts[pts.length - 1][0].toFixed(1) + ' ' + y(0) + 'L' + x(0) + ' ' + y(0) + 'Z" fill="var(--road-soft)" opacity=".7"/>';
      svg += '<path d="M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L') + '" fill="none" stroke="var(--road)" stroke-width="2.5"/>';
      const e = pts[pts.length - 1]; svg += '<circle cx="' + e[0] + '" cy="' + e[1] + '" r="4.5" fill="var(--road)"/>';
    }
    svg += '</svg>';
    return '<div class="sec-h"><h3>予定と実際の累計</h3><span class="sub">点線が予算どおりのペース</span></div>' + svg + (ti.phase === 'before' ? '<p class="sub">旅が始まると、青い線が伸びていきます</p>' : '');
  }
  function budgetSheet() {
    openSheet('<h2>予算を決める</h2>' +
      '<div class="link-box"><label class="f">総額から割り振る（万円）<div class="row"><input class="i num grow" type="number" inputmode="decimal" step="1" min="0" id="bud-total" placeholder="例: 400"><button class="btn" type="button" id="bud-split">割り振る</button></div></label>' +
      '<p class="sub" style="margin:0">宿泊38%・食費26%・交通10%・ガソリン・高速9%・観光・体験7%・予備費10%で分けます。分けたあとに項目ごとに直せます</p></div>' +
      '<p class="sub">項目ごとに万円で入れてください</p><form id="bud-form" style="display:flex;flex-direction:column;gap:12px">' +
      CATS.map((c) => '<label class="f">' + esc(c.b) + (c.hint ? '（' + esc(c.hint) + '）' : '') + '<input class="i num" type="number" inputmode="decimal" step="0.1" min="0" data-bud="' + esc(c.b) + '" value="' + (budgetOf(c.b) / 10000) + '"></label>').join('') +
      '<div class="row"><button class="btn primary grow" type="submit">保存</button><button class="btn" type="button" data-close>閉じる</button></div></form>');
    $('#bud-split').addEventListener('click', () => {
      const t = parseFloat($('#bud-total').value) || 0; if (!t) { toast('総額を入れてください'); return; }
      const ratio = { '宿泊': 0.38, '食費': 0.26, '交通': 0.10, 'ガソリン・高速': 0.09, '観光・体験': 0.07, '予備費': 0.10 };
      document.querySelectorAll('[data-bud]').forEach((i) => { i.value = String(Math.round(t * (ratio[i.dataset.bud] || 0) * 10) / 10); });
    });
    $('#bud-form').addEventListener('submit', async (e) => {
      e.preventDefault(); const d = {}; document.querySelectorAll('[data-bud]').forEach((i) => { d[i.dataset.bud] = Math.round((parseFloat(i.value) || 0) * 10000); });
      try { await S.db.doc('meta/budget').set(d); closeSheet(); toast('予算を保存しました'); } catch (er) { fail(er); }
    });
  }

  // ---------- やりたいこと ----------
  function vWish() {
    const codes = Object.keys(S.wishPrefs).sort();
    if (!S.loaded.wishes) return '<div class="empty">やりたいことを読み込んでいます</div>';
    if (!codes.length) return '<div class="empty">やりたいことはまだありません</div>';
    let tot = 0, dn = 0, see = [0, 0], eat = [0, 0];
    codes.forEach((c) => S.wishPrefs[c].items.forEach((w) => { tot++; const d = !!S.done[w.id]; if (d) dn++; const t = w.k === 'eat' ? eat : see; t[1]++; if (d) t[0]++; }));
    const pct = tot ? dn / tot : 0, R0 = 40, C0 = 2 * Math.PI * R0;
    let h = '<section class="card" style="display:flex;flex-direction:column;gap:14px"><div class="row" style="gap:16px">' +
      '<svg class="ring" viewBox="0 0 96 96" role="img" aria-label="達成 ' + Math.round(pct * 100) + '%"><circle cx="48" cy="48" r="' + R0 + '" fill="none" stroke="var(--sunk)" stroke-width="10"/><circle cx="48" cy="48" r="' + R0 + '" fill="none" stroke="var(--road)" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + (C0 * pct).toFixed(1) + ' ' + C0.toFixed(1) + '" transform="rotate(-90 48 48)"/><text x="48" y="54" text-anchor="middle" font-size="20" font-weight="700" font-family="Inter,sans-serif" fill="var(--ink)">' + Math.round(pct * 100) + '%</text></svg>' +
      '<div class="grow" style="min-width:140px"><h2>やりたいこと</h2><p class="sub num">' + dn + ' / ' + tot + ' 達成</p><p class="sub num">見る ' + see[0] + '/' + see[1] + '・食べる ' + eat[0] + '/' + eat[1] + '</p></div>' +
      '<button class="btn primary wish-add" id="wish-new"' + (can() ? '' : ' disabled') + '>＋ 追加</button></div>' +
      '<div class="pgrid" role="group" aria-label="都道府県で絞り込み">' + codes.map((c) => {
        const p = S.wishPrefs[c]; const n = p.items.length, d = p.items.filter((w) => S.done[w.id]).length, v = n ? d / n : 0;
        return '<button class="ptile" data-pref="' + esc(c) + '" aria-pressed="' + (UI.wishPref === c) + '" style="background:' + (v > 0 ? 'var(--road-soft)' : 'var(--surface)') + ';background:color-mix(in srgb,var(--road) ' + Math.round(v * 60) + '%,var(--surface));' + (v > 0.55 ? 'color:var(--road-ink)' : '') + '">' + esc(p.pref) + '<small' + (v > 0.55 ? ' style="color:inherit"' : '') + '>' + d + '/' + n + '</small></button>';
      }).join('') + '</div>' +
      '<div class="row"><div class="chips" role="group" aria-label="種類">' + [['all', 'すべて'], ['see', '見る'], ['eat', '食べる']].map((x) => '<button class="chip" data-wk="' + x[0] + '" aria-pressed="' + (UI.wishKind === x[0]) + '">' + x[1] + '</button>').join('') + '</div>' +
      '<label class="row" style="font-size:13px;font-weight:700;color:var(--muted);gap:6px;min-height:44px"><input type="checkbox" id="hide-done"' + (UI.hideDone ? ' checked' : '') + ' style="width:20px;height:20px">達成したものを隠す</label>' +
      (UI.wishPref ? '<button class="btn small" data-pref="">都道府県の絞り込みを外す</button>' : '') + '</div></section>';
    const show = UI.wishPref ? [UI.wishPref] : codes;
    show.forEach((c) => {
      const p = S.wishPrefs[c]; if (!p) return;
      const items = p.items.filter((w) => (UI.wishKind === 'all' || w.k === UI.wishKind) && !(UI.hideDone && S.done[w.id]));
      if (!items.length && !UI.wishPref) return;
      h += '<section class="card"><div class="sec-h"><h3>' + esc(p.pref) + '</h3><span class="sub num">' + p.items.filter((w) => S.done[w.id]).length + '/' + p.items.length + '</span></div>' +
        (items.length ? items.map((w) => '<div class="wish' + (S.done[w.id] ? ' done' : '') + '"><label style="display:flex;align-items:flex-start;gap:12px;flex:1;min-width:0;cursor:pointer"><input type="checkbox" data-wish="' + esc(w.id) + '"' + (S.done[w.id] ? ' checked' : '') + (can() ? '' : ' disabled') + '><span class="grow"><span class="n">' + esc(w.n) + '</span> <span class="pill">' + (w.k === 'eat' ? '食べる' : '見る') + '</span>' + (w.d ? '<br><span class="d">' + esc(w.d) + '</span>' : '') + doneBy(S.done[w.id]) + '</span></label>' +
          (can() ? '<span class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn small" data-edit-wish="' + esc(c + '|' + w.id) + '" aria-label="' + esc(w.n) + 'を直す">直す</button><button class="btn small" data-del-wish="' + esc(c + '|' + w.id) + '" aria-label="' + esc(w.n) + 'を消す">消す</button></span>' : '') + '</div>').join('') : '<div class="empty" style="margin-top:10px">該当するものはありません</div>') +
        '</section>';
    });
    return h;
  }
  function wishSheet(code, id) {
    const p = code ? S.wishPrefs[code] : null;
    const w = p && id ? p.items.find((x) => x.id === id) : null;
    const cur = w ? code : (UI.wishPref || '');
    const codes = Object.keys(S.wishPrefs).sort();
    openSheet('<h2>' + (w ? 'やりたいことを直す' : 'やりたいことを追加') + '</h2><form id="wish-form" style="display:flex;flex-direction:column;gap:12px">' +
      '<label class="f">名前<input class="i" id="wf-name" required value="' + esc(w ? w.n : '') + '" placeholder="例: 函館の夜景"></label>' +
      '<label class="f">くわしく（なくてもよい）<input class="i" id="wf-d" value="' + esc(w ? w.d : '') + '" placeholder="例: 函館山から見る"></label>' +
      '<div class="grid2"><label class="f">都道府県<select class="i" id="wf-pref" required><option value="">選んでください</option>' + codes.map((c) => '<option value="' + esc(c) + '"' + (c === cur ? ' selected' : '') + '>' + esc(S.wishPrefs[c].pref) + '</option>').join('') + '</select></label>' +
      '<label class="f">種類<select class="i" id="wf-kind"><option value="see"' + (w && w.k === 'eat' ? '' : ' selected') + '>見る</option><option value="eat"' + (w && w.k === 'eat' ? ' selected' : '') + '>食べる</option></select></label></div>' +
      '<div class="row"><button class="btn primary grow" type="submit"' + (can() ? '' : ' disabled') + '>' + (w ? '保存' : '追加') + '</button><button class="btn" type="button" data-close>閉じる</button></div></form>');
    $('#wish-form').addEventListener('submit', async (e) => {
      e.preventDefault(); if (!can()) return;
      const name = $('#wf-name').value.trim(), to = $('#wf-pref').value;
      if (!name) { toast('名前を入れてください'); return; }
      if (!to || !S.wishPrefs[to]) { toast('都道府県を選んでください'); return; }
      const item = { id: w ? w.id : 'w' + to + '-u' + Date.now().toString(36), k: $('#wf-kind').value, n: name, d: $('#wf-d').value.trim() };
      try {
        if (w && to === code) {
          await S.db.doc('wishes/p' + code).update({ items: p.items.map((x) => (x.id === w.id ? item : x)) });
        } else {
          await S.db.doc('wishes/p' + to).update({ items: S.wishPrefs[to].items.concat([item]) });
          if (w) await S.db.doc('wishes/p' + code).update({ items: p.items.filter((x) => x.id !== w.id) });
        }
        closeSheet(); toast(w ? '直しました' : '追加しました');
      } catch (er) { fail(er); }
    });
  }

  // ---------- 日記 ----------
  // 日記の「場所」は書いた時点のものを保存する。日程を前倒ししても書いた場所は変わらない
  const diaryHas = (d) => d && (String(d.text || '').trim() || (d.photos || []).length);
  function plannedPlace(sch, k) { const dt = parseD(k); const s = sch.find((x) => dt >= x.start && dt < x.end); return s ? s.place : ''; }
  function vDiary(sch, ti) {
    if (!UI.diaryDate || UI.diaryAuto) { UI.diaryDate = iso(today()); UI.diaryAuto = true; }
    const k = UI.diaryDate, dd = parseD(k);
    const e = S.diary[k] || {};
    const exists = diaryHas(e);
    const photos = Array.isArray(e.photos) ? e.photos : [];
    const place = e.place !== undefined ? e.place : '';
    const planned = plannedPlace(sch, k);
    let h = '<section class="card" style="display:flex;flex-direction:column;gap:12px" id="diary-editor"><div class="sec-h"><h2>' + (exists ? '日記を直す' : '日記を書く') + '</h2>' +
      (exists ? '<span class="pill booked">保存済み</span>' : '') + '</div>' +
      '<div class="row"><button class="btn small dd" data-dd="-1" aria-label="前の日">‹<span class="wide"> 前の日</span></button><input class="i grow" type="date" id="diary-date" value="' + esc(k) + '" aria-label="日付"><button class="btn small dd" data-dd="1" aria-label="次の日"><span class="wide">次の日 </span>›</button></div>' +
      '<label class="f">いた場所<input class="i" id="diary-place" value="' + esc(place) + '" placeholder="' + esc(planned ? '空のままなら「' + planned + '」になります' : '例: 函館') + '"></label>' +
      (planned && !place ? '<p class="sub">行程では、この日は「' + esc(planned) + '」の予定です。違う所にいたら、場所を入れてください</p>' : (planned && planned !== place ? '<p class="sub">行程では、この日は「' + esc(planned) + '」の予定です</p>' : '')) +
      '<label class="f">' + mdw(dd) + 'のこと<textarea class="i" id="diary-text" placeholder="行った所、食べた物、ひと言">' + esc(e.text) + '</textarea></label>' +
      (photos.length ? '<div class="photos">' + photos.map((p) => '<div class="ph-wrap"><button type="button" class="view" data-view-photo="' + esc(p) + '" aria-label="写真を大きく見る"><img src=\"' + esc(ctx.assets.src(p)) + '" alt="' + esc(mdw(dd)) + 'の写真" loading="lazy"></button>' +
        (can() ? '<button type="button" class="x" data-del-photo="' + esc(p) + '" aria-label="この写真を外す">×</button>' : '') + '</div>').join('') + '</div>' : '') +
      '<div class="row"><button class="btn primary grow" id="diary-save"' + (can() ? '' : ' disabled') + '>保存</button>' +
      (S.assets ? '<label class="btn" for="diary-photo">写真を追加</label><input type="file" id="diary-photo" accept="image/*" multiple hidden>' : '') + '</div>' +
      (exists && can() ? '<div class="row"><span class="grow"></span><button class="btn small danger" type="button" data-del-diary="' + esc(k) + '">この日の日記を消す</button></div><div id="diary-confirm"></div>' : '') +
      '</section>';
    const keys = Object.keys(S.diary).filter((x) => diaryHas(S.diary[x])).sort();
    if (UI.diaryOrder !== 'old') keys.reverse();
    h += '<section style="display:flex;flex-direction:column;gap:10px"><div class="sec-h"><h2>これまでの日記</h2><span class="sub num">' + keys.length + '日分</span></div>' +
      (keys.length > 1 ? '<div class="chips" role="group" aria-label="並び順">' + [['new', '新しい順'], ['old', '古い順']].map((x) => '<button class="chip" data-dorder="' + x[0] + '" aria-pressed="' + ((UI.diaryOrder || 'new') === x[0]) + '">' + x[1] + '</button>').join('') + '</div>' : '');
    if (!keys.length) h += '<div class="empty">まだ日記はありません。上の欄に書いて保存すると、ここに並びます</div>';
    let lastM = '';
    keys.forEach((x) => {
      const d = S.diary[x], dt = parseD(x), m = dt.getFullYear() + '年' + (dt.getMonth() + 1) + '月';
      if (m !== lastM) { h += '<p class="month-h">' + m + '</p>'; lastM = m; }
      const pl = d.place !== undefined ? d.place : plannedPlace(sch, x);
      const ph = Array.isArray(d.photos) ? d.photos : [];
      h += '<article class="entry' + (x === k ? ' editing' : '') + '"><div class="entry-h"><b>' + mdw(dt) + '</b><span class="sub">' + esc(pl || '場所なし') + '</span>' + (x === k ? '<span class="pill booked">編集中</span>' : '') + '</div>' +
        (String(d.text || '').trim() ? '<p class="entry-text">' + esc(d.text) + '</p>' : '') +
        (ph.length ? '<div class="strip">' + ph.map((p) => '<button type="button" data-view-photo="' + esc(p) + '" aria-label="写真を大きく見る"><img src=\"' + esc(ctx.assets.src(p)) + '" alt="' + esc(mdw(dt)) + 'の写真" loading="lazy"></button>').join('') + '</div>' : '') +
        (can() ? '<div class="row"><button class="btn small" data-edit-diary="' + esc(x) + '">直す</button></div>' : '') + '</article>';
    });
    return h + '</section>';
  }
  async function saveDiary(extraPhotos, removePhoto) {
    if (!can()) return;
    const k = UI.diaryDate, cur = S.diary[k] || {};
    const ta = $('#diary-text'), pi = $('#diary-place');
    const text = ta ? ta.value : (cur.text || '');
    const typed = pi ? pi.value.trim() : (cur.place !== undefined ? cur.place : '');
    const place = typed || plannedPlace(schedule(), k);
    const photos = (Array.isArray(cur.photos) ? cur.photos : []).filter((p) => p !== removePhoto).concat(extraPhotos || []);
    try {
      await S.db.doc('diary/' + k).set({ text, place, photos, by: S.me || '', at: Date.now() });
      toast(removePhoto ? '写真を外しました' : '日記を保存しました');
    } catch (er) { fail(er); }
  }

  // ---------- シート ----------
  function openSheet(html) {
    $('#sheet-root').innerHTML = '<div class="sheet-bg" data-close></div><div class="sheet" role="dialog" aria-modal="true"><div class="sheet-in"><div class="grab" aria-hidden="true"></div>' + html + '</div></div>';
    const f = $('#sheet-root input, #sheet-root select, #sheet-root textarea'); if (f) setTimeout(() => f.focus({ preventScroll: true }), 50);
  }
  function closeSheet() { $('#sheet-root').innerHTML = ''; }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#sheet-root').innerHTML) closeSheet(); });

  // ---------- 操作 ----------
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button,[data-close],a'); if (!t) return;
    if (t.hasAttribute('data-close')) { closeSheet(); return; }
    if (t.dataset.zone !== undefined) { setZone(+t.dataset.zone); return; }
    if (t.dataset.zoom) { const svg = $('#mapsvg'); const r = svg.getBoundingClientRect(); zoomAt(t.dataset.zoom === 'in' ? 0.7 : 1.4, r.left + r.width / 2, r.top + r.height / 2); return; }
    if (t.dataset.editStop) { stopSheet(t.dataset.editStop); return; }
    if (t.dataset.jump !== undefined) { const el = $('#reg-' + t.dataset.jump); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (t.dataset.bf) { UI.bookFilter = t.dataset.bf; render(); return; }
    if (t.id === 'bk-add') { bookingSheet(null); return; }
    if (t.dataset.editB) { bookingSheet(t.dataset.editB); return; }
    if (t.dataset.cycleB && can()) { const b = S.bookings.find((x) => x.id === t.dataset.cycleB); if (b) try { const ns = nextStatus(b.status); await S.db.doc('bookings/' + b.id).update({ status: ns }); askAuto('booking', b.id, ns, b.title); } catch (er) { fail(er); } return; }
    if (t.dataset.cycleS && can()) { const s = S.stops.find((x) => x.id === t.dataset.cycleS); if (s) try { const ns = nextStatus(s.booking); await S.db.doc('stops/' + s.id).update({ booking: ns }); askAuto('stop', s.id, ns, s.place + 'の宿代'); } catch (er) { fail(er); } return; }
    if (t.dataset.editEx) { expenseSheet(t.dataset.editEx); return; }
    if (t.dataset.autoRec) { if (t.disabled) return; t.disabled = true; const box = $('#auto-box'); if (box) box.dataset.key = t.dataset.autoRec; const [ty, id] = t.dataset.autoRec.split('|'); await recordAuto(ty, id); if (t.dataset.thenClose) closeSheet(); else refreshAutoBox(); return; }
    if (t.dataset.autoUn) { const [ty, id] = t.dataset.autoUn.split('|'); const box = $('#auto-box'); if (box) box.dataset.key = t.dataset.autoUn; await unrecordAuto(ty, id); if (!box || t.dataset.thenClose) closeSheet(); else refreshAutoBox(); return; }
    if (t.dataset.move && can()) { const [id, d] = t.dataset.move.split('|'); moveStop(id, +d); return; }
    if (t.id === 'plan-add') { stopSheet(null, null); return; }
    if (t.id === 'bud-edit' || t.id === 'bud-edit2') { budgetSheet(); return; }
    if (t.dataset.cat) { document.querySelectorAll('#ex-cats [data-cat]').forEach((b) => { const on = b === t; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-checked', String(on)); }); return; }
    if (t.id === 'ex-more') { UI.expAll = !UI.expAll; render(); return; }
    if (t.dataset.pref !== undefined) { UI.wishPref = t.dataset.pref || null; render(); window.scrollTo({ top: 0 }); return; }
    if (t.dataset.wk) { UI.wishKind = t.dataset.wk; render(); return; }
    if (t.id === 'wish-new') { wishSheet(null, null); return; }
    if (t.dataset.editWish) { const [c, id] = t.dataset.editWish.split('|'); wishSheet(c, id); return; }
    if (t.dataset.delWish && can()) {
      const [c, id] = t.dataset.delWish.split('|'); const p = S.wishPrefs[c]; if (!p) return;
      if (t.dataset.armed) {
        try { await S.db.doc('wishes/p' + c).update({ items: p.items.filter((x) => x.id !== id) }); if (S.done[id]) await S.db.doc('wishdone/' + id).delete(); toast('消しました'); } catch (er) { fail(er); }
      } else {
        t.dataset.armed = '1'; t.textContent = '本当に消す'; t.classList.add('danger');
        setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; t.textContent = '消す'; t.classList.remove('danger'); } }, 3000);
      }
      return;
    }
    if (t.dataset.dd) { UI.diaryAuto = false; UI.diaryDate = iso(addD(parseD(UI.diaryDate), +t.dataset.dd)); render(); return; }
    if (t.id === 'diary-save') { saveDiary([]); return; }
    if (t.dataset.editDiary) { UI.diaryAuto = false; UI.diaryDate = t.dataset.editDiary; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (t.dataset.dorder) { UI.diaryOrder = t.dataset.dorder; render(); return; }
    if (t.dataset.viewPhoto) { openSheet('<img class="big-photo" src=\"' + esc(ctx.assets.src(t.dataset.viewPhoto)) + '" alt="写真"><button class="btn" type="button" data-close>閉じる</button>'); return; }
    if (t.dataset.delPhoto) {
      const id = t.dataset.delPhoto;
      if (t.dataset.armed) { await saveDiary([], id); if (S.assets) { try { await S.assets.delete(id); } catch (er) {} } return; }
      t.dataset.armed = '1'; t.textContent = '消す'; t.style.width = 'auto'; t.style.padding = '0 10px';
      setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; t.textContent = '×'; t.style.width = ''; t.style.padding = ''; } }, 3000);
      return;
    }
    if (t.dataset.delDiary) {
      const k = t.dataset.delDiary;
      $('#diary-confirm').innerHTML = '<div class="banner row"><span class="grow">' + esc(mdw(parseD(k))) + 'の日記を消します。文章と写真が消え、元に戻せません</span><button class="btn small danger" type="button" id="diary-del2">消す</button></div>';
      $('#diary-del2').addEventListener('click', async () => {
        const photos = (S.diary[k] && Array.isArray(S.diary[k].photos)) ? S.diary[k].photos.slice() : [];
        try { await S.db.doc('diary/' + k).delete(); toast('日記を消しました'); } catch (er) { fail(er); return; }
        if (S.assets) for (const p of photos) { try { await S.assets.delete(p); } catch (er) {} }
      });
      return;
    }
  });
  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'trip-start' && can() && t.value) { try { await S.db.doc('meta/trip').set({ ...S.trip, start: t.value }); toast('出発日を変えました'); } catch (er) { fail(er); } return; }
    if (t.dataset.wish && can()) {
      const id = t.dataset.wish;
      try { if (t.checked) await S.db.doc('wishdone/' + id).set({ done: true, at: Date.now(), by: S.me || '' }); else await S.db.doc('wishdone/' + id).delete(); } catch (er) { fail(er); t.checked = !t.checked; }
      return;
    }
    if (t.id === 'hide-done') { UI.hideDone = t.checked; try { localStorage.setItem('tabicho-ui', JSON.stringify({ hideDone: UI.hideDone })); } catch (er) {} render(); return; }
    if (t.id === 'diary-date' && t.value) { UI.diaryAuto = false; UI.diaryDate = t.value; render(); return; }
    if (t.id === 'diary-photo' && t.files && t.files.length && S.assets) {
      const ids = []; toast('写真を縮めて保存しています');
      for (const f of t.files) { try { const r = await S.assets.upload(f); ids.push(r.id); } catch (er) { toast('写真を保存できませんでした。写真の形式が対応していないか、容量がいっぱいです'); } }
      if (ids.length) saveDiary(ids);
    }
  });
  document.addEventListener('submit', async (e) => {
    if (e.target.id === 'ex-form') {
      e.preventDefault(); if (!can()) return;
      const amt = parseInt($('#ex-amt').value, 10); if (!amt || amt < 0) { toast('金額を入れてください'); return; }
      const cat = ($('#ex-cats [aria-pressed="true"]') || {}).dataset?.cat || '食費';
      try { await S.db.collection('expenses').add({ amount: amt, cat, date: $('#ex-date').value || iso(today()), memo: $('#ex-memo').value.trim(), by: S.me || '', at: Date.now() }); $('#ex-amt').value = ''; $('#ex-memo').value = ''; toast(yen(amt) + 'を記録しました'); } catch (er) { fail(er); }
    }
  });

  // ---------- ルーティング ----------
  function route() { const h = (location.hash || '').slice(1); UI.view = VIEWS.some((v) => v.id === h) ? h : 'map'; closeSheet(); render(); window.scrollTo({ top: 0 }); }
  window.addEventListener('hashchange', route);
  // アプリを開いたまま日付が変わったとき（翌朝に開き直したときなど）、今日に合わせて描き直す
  let lastDay = iso(today());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && iso(today()) !== lastDay) { lastDay = iso(today()); render(); } });
  window.addEventListener('resize', () => { if (UI.view === 'map') applyVB(); });

  // ---------- データ ----------
  fetch(import.meta.env.BASE_URL + 'japan.json').then((r) => r.json()).then((g) => { UI.geo = g; if (UI.view === 'map') { initGeoPaths(); render(); } }).catch(() => {});
  route();
  (() => {
    const db = ctx.db;
    S.db = db; S.assets = ctx.assets;
    const map = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // 読み込んだデータの形をそろえる。書き出したファイルや、あとで共有する相手のデータは、形が崩れていることがあるため
    const num = (v) => (Number.isFinite(+v) ? +v : 0);
    const str = (v) => (v == null ? '' : String(v));
    const coord = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const normStop = (o) => ({ ...o, place: str(o.place), pref: str(o.pref), lodging: str(o.lodging), lodgingName: str(o.lodgingName), what: str(o.what), memo: str(o.memo),
      nights: Math.max(0, Math.min(MAX_NIGHTS, Math.floor(num(o.nights)))), region: Math.max(0, Math.min(REG.length - 1, Math.floor(num(o.region)))),
      order: num(o.order), cost: Math.max(0, num(o.cost)), ...(coord(o.lat) !== undefined && coord(o.lng) !== undefined ? { lat: o.lat, lng: o.lng } : { lat: undefined, lng: undefined }),
      kind: KIND[o.kind] ? o.kind : 'T', booking: BOOK[o.booking] ? o.booking : 'none', arrive: ['car', 'ship', 'plane'].includes(o.arrive) ? o.arrive : 'car' });
    const normMoney = (o) => ({ ...o, amount: Math.max(0, num(o.amount)), date: /^\d{4}-\d{2}-\d{2}$/.test(str(o.date)) ? o.date : '' });
    db.collection('stops').onSnapshot((s) => { S.stops = map(s).map(normStop).sort((a, b) => (a.order || 0) - (b.order || 0)); S.loaded.stops = true; S.live = true; render(); });
    db.collection('wishes').onSnapshot((s) => { const o = {}; s.docs.forEach((d) => { const v = d.data(); if (v && /^\d{2}$/.test(str(v.code))) o[v.code] = { ...v, pref: str(v.pref), items: Array.isArray(v.items) ? v.items.filter((w) => w && typeof w.id === 'string').map((w) => ({ ...w, n: str(w.n), d: str(w.d), k: w.k === 'eat' ? 'eat' : 'see' })) : [] }; }); S.wishPrefs = o; S.loaded.wishes = true; render(); });
    db.collection('wishdone').onSnapshot((s) => { const o = {}; s.docs.forEach((d) => { o[d.id] = d.data() || { done: true }; }); S.done = o; render(); });
    db.collection('bookings').onSnapshot((s) => { S.bookings = map(s).map(normMoney).map((b) => ({ ...b, title: str(b.title), kind: str(b.kind), memo: str(b.memo), stopId: str(b.stopId), status: BOOK[b.status] ? b.status : 'none' })); S.loaded.bookings = true; render(); });
    db.collection('expenses').onSnapshot((s) => { S.expenses = map(s).map(normMoney).map((e) => ({ ...e, date: e.date || iso(today()), cat: str(e.cat), memo: str(e.memo) })); S.loaded.expenses = true; refreshAutoBox(); render(); });
    db.collection('diary').onSnapshot(async (s) => {
      const o = {}; s.docs.forEach((d) => { o[d.id] = d.data(); }); S.diary = o;
      const ids = Object.values(o).flatMap((d) => (d && Array.isArray(d.photos) ? d.photos : []));
      await ctx.assets.preload(ids); render();
    });
    db.doc('meta/trip').onSnapshot((d) => { if (d.exists) S.trip = { start: iso(today()), ...d.data() }; render(); });
    db.doc('meta/budget').onSnapshot((d) => { S.budget = d.exists ? d.data() : null; render(); });
  })();
}
