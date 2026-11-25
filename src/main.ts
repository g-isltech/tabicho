import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { Store, scopedDb, newId } from './store';
import { Photos } from './photos';
import { exportZip, importZip, saveFile } from './backup';
import { startApp } from './app.js';
import { buildShare, shareZip, shareHtml, DEFAULT_SHARE, type ShareOptions } from './share';

const PREFS = ['北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島', '茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川', '新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知', '三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山', '鳥取', '島根', '岡山', '広島', '山口', '徳島', '香川', '愛媛', '高知', '福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'];
const BUDGET_KEYS = ['宿泊', '食費', '交通', 'ガソリン・高速', '観光・体験', '予備費'];
const REMIND_DAYS = 14;

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

registerSW({ immediate: true });

const store = new Store();
const photos = new Photos(store);

interface Trip { id: string; name: string; createdAt: number; readonly: boolean }

function trips(): Trip[] {
  return store.list('trips').map((r) => ({ id: r.id, name: String(r.data?.name || '名前のない旅'), createdAt: Number(r.data?.createdAt || 0), readonly: !!r.data?.readonly }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function createTrip(name: string, start: string): Promise<string> {
  const tid = 't' + newId();
  const p = 'trips/' + tid + '/';
  await store.write('trips/' + tid, { name, createdAt: Date.now() });
  await store.write(p + 'meta/trip', { start });
  await store.write(p + 'meta/budget', Object.fromEntries(BUDGET_KEYS.map((k) => [k, 0])));
  for (let i = 0; i < PREFS.length; i++) {
    const code = String(i + 1).padStart(2, '0');
    await store.write(p + 'wishes/p' + code, { pref: PREFS[i], code, items: [] });
  }
  return tid;
}

function sheet(html: string): void {
  $('#sheet-root')!.innerHTML = '<div class="sheet-bg" data-close></div><div class="sheet" role="dialog" aria-modal="true"><div class="sheet-in"><div class="grab" aria-hidden="true"></div>' + html + '</div></div>';
}
function closeSheet(): void { $('#sheet-root')!.innerHTML = ''; }
function toast(msg: string): void {
  const r = $('#toast-root')!; r.innerHTML = '<div class="toast" role="status">' + esc(msg) + '</div>';
  setTimeout(() => { r.innerHTML = ''; }, 2400);
}

// zip を作るのに時間がかかるので、作り終えてから「保存する」をもう一度押してもらう（共有シートはボタンを押した直後にしか開けないため）
// tripId を渡すとその旅だけ、渡さないとすべての旅を書き出す
async function doExport(tripId?: string): Promise<void> {
  let blob: Blob;
  try { toast('書き出す準備をしています'); blob = await exportZip(store, tripId); }
  catch (e) { toast('書き出せませんでした'); console.error(e); return; }
  const tripName = tripId ? String(store.read('trips/' + tripId)?.name || '旅') : '';
  // ファイル名に日本語を使うと、ブラウザによっては名前が消えるので英数字にする（旅の名前はファイルの中に入っている）
  const name = 'tabicho-' + (tripId ? 'trip' : 'all') + '-' + todayIso().replace(/-/g, '') + '.zip';
  sheet('<h2>書き出す準備ができました</h2><p style="margin:0">' + (tripId ? '「' + esc(tripName) + '」だけ' : 'すべての旅') + '・' + esc(name) + '（' + (blob.size / 1024 / 1024).toFixed(1) + 'MB）</p>' +
    '<p class="sub">iPhone では、開いた画面で「\"ファイル\"に保存」を選んでください。iCloud Drive などに置いておくと、機種変更のときも安心です。</p>' +
    '<div class="row"><button class="btn primary grow" type="button" id="ex-save">保存する</button><button class="btn" type="button" data-close>やめる</button></div>');
  $('#ex-save')!.addEventListener('click', async () => {
    const r = await saveFile(blob, name);
    if (r === 'cancelled') return;
    if (!tripId) await store.setSetting('lastExport', Date.now());
    closeSheet(); toast('書き出しました');
    $('#export-banner')?.remove();
  });
}

async function doImport(file: File): Promise<void> {
  try {
    const r = await importZip(store, file);
    // 読み込んだ旅を表示する。今までの旅は残るので、設定から切り替えたり消したりできる
    if (r.tripIds.length) await store.setSetting('currentTrip', r.tripIds[0]);
    const name = r.tripIds.length ? String(store.read('trips/' + r.tripIds[0])?.name || '') : '';
    toast(name ? '「' + name + '」を読み込みました。今までの旅は設定から切り替えられます' : '読み込みました（データ' + r.docs + '件・写真' + r.photos + '枚）');
    setTimeout(() => location.reload(), 1600);
  } catch (e) { toast(e instanceof Error ? e.message : '読み込めませんでした'); }
}

// ---------- 旅の記録の共有 ----------
const SHARE_ITEMS: [keyof ShareOptions, string, string][] = [
  ['diary', '日記の文章', ''],
  ['photos', '日記の写真', '撮影場所などの情報は消してあります'],
  ['wishes', 'やりたいことと、かなえたこと', ''],
  ['realDates', '本当の日付', '見せないときは「1日目」「2日目」と表示します'],
  ['lodgingNames', '宿・キャンプ場の名前', '見せないときは地名だけです'],
  ['money', '予算と出費', ''],
  ['bookings', '予約（移動・見学）', '予約のメモは入れません']
];
function tripRange(tid: string): { start: Date; end: Date } {
  const st = String(store.read('trips/' + tid + '/meta/trip')?.start || todayIso());
  const [y, m, d] = st.split('-').map(Number); const start = new Date(y, m - 1, d);
  const nights = store.list('trips/' + tid + '/stops').reduce((a, r) => a + (Number(r.data?.nights) || 0), 0);
  return { start, end: new Date(y, m - 1, d + nights) };
}
async function shareSheet(current: Trip): Promise<void> {
  let saved: Partial<ShareOptions> = {};
  try { saved = (await store.getSetting<Partial<ShareOptions>>('shareOptions')) || {}; } catch { /* 初めて */ }
  const opt: ShareOptions = { ...DEFAULT_SHARE, ...saved };
  const { start, end } = tripRange(current.id); const now = new Date();
  const during = now >= start && now < end;
  sheet('<h2>旅の記録を共有する</h2><p style="margin:0">「' + esc(current.name) + '」を人に見せるためのファイルを作ります。行程と地図はいつも入ります。メモは入りません。</p>' +
    (during ? '<p class="banner" style="margin:0">今は旅の途中です。共有すると、今いる場所や家を空けていることが相手に伝わります。旅が終わってから共有するのがおすすめです。</p>' : '') +
    '<form id="sh-form" style="display:flex;flex-direction:column;gap:2px"><h3>見せる項目</h3>' +
    SHARE_ITEMS.map(([k, label, note]) => '<label class="setting-row" style="cursor:pointer"><span class="grow">' + esc(label) + (note ? '<br><span class="sub">' + esc(note) + '</span>' : '') + '</span><input type="checkbox" data-sh="' + k + '"' + (opt[k] ? ' checked' : '') + ' style="width:24px;height:24px;accent-color:var(--road)"></label>').join('') +
    '<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">' +
    '<button class="btn primary" type="button" data-sh-make="html">見るだけのページを作る</button><p class="sub" style="margin:0">HTML ファイル1つ。旅帳を持っていない人も、受け取ってタップすれば見られます</p>' +
    '<button class="btn" type="button" data-sh-make="zip">旅帳で開けるファイルを作る</button><p class="sub" style="margin:0">受け取った人の旅帳に「もらった旅」として入ります。見るだけで、もとに自分の旅を作れます</p>' +
    '<button class="btn" type="button" data-close>やめる</button></div></form>');
  document.querySelectorAll<HTMLButtonElement>('[data-sh-make]').forEach((b) => b.addEventListener('click', async () => {
    document.querySelectorAll<HTMLInputElement>('[data-sh]').forEach((i) => { (opt as unknown as Record<string, boolean>)[i.dataset.sh!] = i.checked; });
    try { await store.setSetting('shareOptions', opt); } catch { /* 覚えられなくても続ける */ }
    const kind = b.dataset.shMake as 'html' | 'zip';
    toast('作っています');
    let blob: Blob;
    try {
      const built = buildShare(store, current.id, opt);
      if (kind === 'zip') blob = await shareZip(store, built);
      else {
        let geo: Record<string, string> | null = null;
        try { geo = await (await fetch(import.meta.env.BASE_URL + 'japan.json')).json(); } catch { /* 地図なしで作る */ }
        blob = await shareHtml(store, built, geo, location.origin + import.meta.env.BASE_URL);
      }
    } catch (e) { console.error(e); toast('作れませんでした'); return; }
    const name = 'tabicho-share-' + todayIso().replace(/-/g, '') + (kind === 'html' ? '.html' : '.zip');
    sheet('<h2>共有するファイルができました</h2><p style="margin:0">' + esc(name) + '（' + (blob.size / 1024 / 1024).toFixed(1) + 'MB）</p>' +
      '<p class="sub">スマホでは、開いた画面から LINE などで送るか、「\"ファイル\"に保存」を選んでください。</p>' +
      '<div class="row"><button class="btn primary grow" type="button" id="sh-save">送る・保存する</button><button class="btn" type="button" data-close>閉じる</button></div>');
    $('#sh-save')!.addEventListener('click', async () => { const r = await saveFile(blob, name); if (r !== 'cancelled') { closeSheet(); toast('できました'); } });
  }));
}
// もらった旅をもとに、自分の旅を作る（行程とやりたいことを写す。日記・お金・予約は写さない）
async function copyTrip(src: Trip): Promise<void> {
  const tid = await createTrip(src.name + '（もとにした旅）', todayIso());
  const from = 'trips/' + src.id + '/', to = 'trips/' + tid + '/';
  for (const r of store.list(from + 'stops')) {
    const s = r.data || {};
    const keep: Record<string, unknown> = {};
    ['order', 'place', 'pref', 'region', 'nights', 'kind', 'lodging', 'what', 'lat', 'lng', 'arrive'].forEach((k) => { if (s[k] !== undefined) keep[k] = s[k]; });
    await store.write(to + 'stops/' + r.id, { ...keep, booking: 'none', cost: 0, lodgingName: '', memo: '' });
  }
  for (const r of store.list(from + 'wishes')) {
    const w = r.data || {}; if (Array.isArray(w.items) && w.items.length) await store.write(to + 'wishes/' + r.id, { pref: w.pref, code: w.code, items: w.items });
  }
  await store.setSetting('currentTrip', tid);
  toast('自分の旅として作りました。出発日を決めてください');
  location.hash = '#plan'; setTimeout(() => location.reload(), 900);
}

// サンプルの旅を読み込む（アプリと一緒に置いてある zip を使う）
async function loadSample(): Promise<void> {
  try {
    const r = await fetch(import.meta.env.BASE_URL + 'sample-trip.zip');
    if (!r.ok) throw new Error('サンプルを取り出せませんでした');
    await doImport(new File([await r.blob()], 'tabicho-sample.zip', { type: 'application/zip' }));
  } catch (e) { toast(e instanceof Error ? e.message : 'サンプルを取り出せませんでした'); }
}

// ---------- はじめての画面 ----------
function onboarding(): void {
  document.body.classList.add('no-tabs');
  $('#trip-name')!.textContent = '旅帳';
  $('#status')!.textContent = '長い旅の行程・予約・お金・やりたいこと・日記を、地図と一緒に';
  $('#view')!.innerHTML = '<section class="card onboard"><h2>旅を作りましょう</h2>' +
    '<p style="margin:0">旅帳は、日本一周のような長い旅を管理するアプリです。データはこの端末の中だけに保存され、どこにも送られません。</p>' +
    '<form id="ob-form" style="display:flex;flex-direction:column;gap:12px">' +
    '<label class="f">旅の名前<input class="i" id="ob-name" required placeholder="例: 日本一周 2027" value="日本一周"></label>' +
    '<label class="f">出発日<input class="i" id="ob-start" type="date" required value="' + todayIso() + '"></label>' +
    '<button class="btn primary" type="submit">旅を作る</button></form>' +
    '<div class="setting-row"><span class="grow">まずは使い方を見てみたいとき<br><span class="sub">北海道を11泊でめぐる、架空の旅が入ります</span></span><button class="btn" type="button" id="ob-sample">サンプルの旅で試す</button></div>' +
    '<p class="sub" style="margin:0">サンプルのファイルは <a href="' + import.meta.env.BASE_URL + 'sample-trip.zip" download="tabicho-sample.zip">ここからダウンロード</a> できます。書き出したファイルの形の見本にもなります。</p>' +
    '<div class="setting-row"><span class="sub">前に書き出したファイルや、一緒に行く人からもらったファイルがあるとき</span><label class="btn" for="ob-file">ファイルから読み込む</label><input type="file" id="ob-file" accept=".zip,application/zip" hidden></div>' +
    '<p class="sub">スマホでは、ブラウザの「ホーム画面に追加」をしてから使ってください。追加しないと、しばらく使わないうちにデータが消えることがあります。</p></section>';
  $('#ob-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = ($('#ob-name') as HTMLInputElement).value.trim() || '旅';
    const start = ($('#ob-start') as HTMLInputElement).value || todayIso();
    const tid = await createTrip(name, start);
    await store.setSetting('currentTrip', tid);
    location.hash = '#plan'; location.reload();
  });
  $('#ob-sample')!.addEventListener('click', loadSample);
  $('#ob-file')!.addEventListener('change', (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) doImport(f); });
}

// ---------- 設定 ----------
async function settings(current: Trip): Promise<void> {
  const tripItem = (t: Trip) => '<button type="button" class="trip-item' + (t.readonly ? ' ro' : '') + '" data-st-trip="' + esc(t.id) + '" aria-current="' + (t.id === current.id) + '"><span class="grow"><b>' + esc(t.name) + '</b>' + (t.readonly ? '<br><span class="sub">見るだけ</span>' : '') + '</span>' + (t.id === current.id ? '<span class="pill booked">表示中</span>' : '<span class="sub">切り替える</span>') + '</button>';
  const last = await store.getSetting<number>('lastExport');
  let persisted: boolean | null = null; let usage = '';
  try { persisted = (await navigator.storage?.persisted?.()) ?? null; const est = await navigator.storage?.estimate?.(); if (est?.usage) usage = (est.usage / 1024 / 1024).toFixed(1) + 'MB'; } catch { /* 取れない端末もある */ }
  const list = trips();
  sheet('<h2>設定とデータ</h2>' +
    '<section style="display:flex;flex-direction:column;gap:8px"><h3>自分の旅</h3>' + (list.filter((t) => !t.readonly).map(tripItem).join('') || '<p class="sub" style="margin:0">まだありません。下から作れます</p>') +
    (list.some((t) => t.readonly) ? '<h3 style="margin-top:8px">もらった旅（見るだけ）</h3>' + list.filter((t) => t.readonly).map(tripItem).join('') : '') +
    '<form id="st-rename" class="row"><input class="i grow" id="st-name" value="' + esc(current.name) + '" aria-label="表示中の旅の名前"><button class="btn" type="submit">名前を変える</button></form>' +
    '<form id="st-new" style="display:flex;flex-direction:column;gap:8px;margin-top:8px"><input class="i" id="st-newname" placeholder="新しい旅の名前" required aria-label="新しい旅の名前"><div class="row"><input class="i grow" id="st-newstart" type="date" value="' + todayIso() + '" aria-label="新しい旅の出発日"><button class="btn" type="submit">新しい旅を作る</button></div></form></section>' +
    (current.readonly
      ? '<section style="display:flex;flex-direction:column;gap:4px"><h3>自分の旅にする</h3><div class="setting-row"><span class="grow">この旅は見るだけです。行程とやりたいことを写して、自分の旅として作れます</span><button class="btn primary" type="button" id="st-copy">この旅をもとに作る</button></div></section>'
      : '<section style="display:flex;flex-direction:column;gap:4px"><h3>旅の記録を共有する</h3><div class="setting-row"><span class="grow">「こんな旅をした」と人に見せるためのファイルを作ります。見せる項目を選べます</span><button class="btn primary" type="button" id="st-share">共有する</button></div></section>') +
    '<section style="display:flex;flex-direction:column;gap:4px"><h3>書き出しと読み込み</h3>' +
    '<div class="setting-row"><span class="grow">表示中の旅「' + esc(current.name) + '」だけを書き出します<br><span class="sub">一緒に行く人に渡すときに使います。渡された人は「読み込む」で開けます</span></span><button class="btn primary" type="button" id="st-export-one">この旅を書き出す</button></div>' +
    '<div class="setting-row"><span class="grow">すべての旅と写真をまとめて書き出します<br><span class="sub">端末が壊れたときのための控えです。最後に書き出した日: ' + (last ? new Date(last).toLocaleDateString('ja-JP') : 'まだありません') + '</span></span><button class="btn" type="button" id="st-export">すべて書き出す</button></div>' +
    '<div class="setting-row"><span class="grow">書き出したファイルを読み込みます。入っていた旅が増えます。同じ旅は新しい方を残します</span><label class="btn" for="st-file">読み込む</label><input type="file" id="st-file" accept=".zip,application/zip" hidden></div>' +
    '<div class="setting-row"><span class="grow">使い方を試せるサンプルの旅（北海道・11泊）を追加します</span><button class="btn" type="button" id="st-sample">サンプルを追加</button></div></section>' +
    '<section style="display:flex;flex-direction:column;gap:4px"><h3>この端末の保存</h3>' +
    '<p class="sub">データはこの端末のブラウザの中だけにあり、どこにも送りません。地名で場所を探すときだけ、探す言葉を国土地理院の検索サービスに送ります。</p>' +
    '<p class="sub">消えにくい保存: ' + (persisted === true ? '有効' : persisted === false ? '無効（ホーム画面に追加すると有効になりやすくなります）' : '不明') + (usage ? '・使っている容量: ' + usage : '') + '</p></section>' +
    '<section style="display:flex;flex-direction:column;gap:8px"><h3>この旅を消す</h3><button class="btn danger" type="button" id="st-del">「' + esc(current.name) + '」を消す</button><div id="st-confirm"></div></section>' +
    '<button class="btn" type="button" data-close>閉じる</button>');
  document.querySelectorAll<HTMLElement>('[data-st-trip]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.stTrip!; if (id === current.id) return;
    await store.setSetting('currentTrip', id); location.reload();
  }));
  $('#st-rename')!.addEventListener('submit', async (e) => {
    e.preventDefault(); const name = ($('#st-name') as HTMLInputElement).value.trim(); if (!name) return;
    const cur = store.read('trips/' + current.id) || {}; await store.write('trips/' + current.id, { ...cur, name });
    $('#trip-name')!.textContent = name; closeSheet(); toast('名前を変えました');
  });
  $('#st-new')!.addEventListener('submit', async (e) => {
    e.preventDefault(); const name = ($('#st-newname') as HTMLInputElement).value.trim(); if (!name) return;
    const tid = await createTrip(name, ($('#st-newstart') as HTMLInputElement).value || todayIso());
    await store.setSetting('currentTrip', tid); location.hash = '#plan'; location.reload();
  });
  $('#st-export')!.addEventListener('click', () => doExport());
  $('#st-share')?.addEventListener('click', () => shareSheet(current));
  $('#st-copy')?.addEventListener('click', () => copyTrip(current));
  $('#st-export-one')!.addEventListener('click', () => doExport(current.id));
  $('#st-sample')!.addEventListener('click', loadSample);
  $('#st-file')!.addEventListener('change', (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) doImport(f); });
  $('#st-del')!.addEventListener('click', () => {
    $('#st-confirm')!.innerHTML = '<div class="banner row"><span class="grow">「' + esc(current.name) + '」の行程・予約・お金・やりたいこと・日記を消します。元に戻せません。先に書き出しておくと安心です</span><button class="btn small danger" type="button" id="st-del2">消す</button></div>';
    $('#st-del2')!.addEventListener('click', async () => {
      await store.removeTrip('trips/' + current.id);
      await store.setSetting('currentTrip', null); location.reload();
    });
  });
}

// ---------- 起動 ----------
async function boot(): Promise<void> {
  await store.open();
  try { await navigator.storage?.persist?.(); } catch { /* 対応していない端末もある */ }
  const list = trips();
  let tid = await store.getSetting<string | null>('currentTrip');
  if (!tid || !list.some((t) => t.id === tid)) tid = list[0]?.id ?? null;
  if (!tid) { onboarding(); return; }
  await store.setSetting('currentTrip', tid);
  const current = list.find((t) => t.id === tid)!;
  $('#trip-name')!.textContent = current.name;
  $('#open-settings')!.addEventListener('click', () => settings(trips().find((t) => t.id === tid) || current));

  const last = await store.getSetting<number>('lastExport');
  const hasData = store.list('trips/' + tid + '/stops').length > 0;
  const curDoc = store.read('trips/' + tid) || {};
  if (hasData && !curDoc.readonly && (!last || Date.now() - last > REMIND_DAYS * 86400000)) {
    const b = document.createElement('div');
    b.id = 'export-banner'; b.className = 'banner row export-banner';
    b.innerHTML = '<span class="grow">' + (last ? REMIND_DAYS + '日以上書き出していません' : 'まだ一度も書き出していません') + '。端末が壊れたときのために、ときどき書き出してください</span><button class="btn small" type="button" id="banner-export">今書き出す</button>';
    $('#view')!.before(b);
    $('#banner-export')!.addEventListener('click', () => doExport());
  }

  const tdoc = store.read('trips/' + tid) || {};
  if (tdoc.readonly) document.body.classList.add('readonly');
  startApp({ db: scopedDb(store, 'trips/' + tid + '/'), assets: photos, readonly: !!tdoc.readonly, hidden: Array.isArray(tdoc.hidden) ? tdoc.hidden : [] });
}

boot().catch((e) => {
  console.error(e);
  $('#view')!.innerHTML = '<div class="empty">データを開けませんでした。ブラウザの設定で、このサイトのデータ保存が止められていないか確認してください。</div>';
});
