import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { Store, scopedDb, newId } from './store';
import { Photos } from './photos';
import { exportZip, importZip, saveFile } from './backup';
import { startApp } from './app.js';

const PREFS = ['北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島', '茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川', '新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知', '三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山', '鳥取', '島根', '岡山', '広島', '山口', '徳島', '香川', '愛媛', '高知', '福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'];
const BUDGET_KEYS = ['宿泊', '食費', '交通', 'ガソリン・高速', '観光・体験', '予備費'];
const REMIND_DAYS = 14;

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

registerSW({ immediate: true });

const store = new Store();
const photos = new Photos(store);

interface Trip { id: string; name: string; createdAt: number }

function trips(): Trip[] {
  return store.list('trips').map((r) => ({ id: r.id, name: String(r.data?.name || '名前のない旅'), createdAt: Number(r.data?.createdAt || 0) }))
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
async function doExport(): Promise<void> {
  let blob: Blob;
  try { toast('書き出す準備をしています'); blob = await exportZip(store); }
  catch (e) { toast('書き出せませんでした'); console.error(e); return; }
  const name = 'tabicho-' + todayIso().replace(/-/g, '') + '.zip';
  sheet('<h2>書き出す準備ができました</h2><p style="margin:0">' + esc(name) + '（' + (blob.size / 1024 / 1024).toFixed(1) + 'MB）</p>' +
    '<p class="sub">iPhone では、開いた画面で「\"ファイル\"に保存」を選んでください。iCloud Drive などに置いておくと、機種変更のときも安心です。</p>' +
    '<div class="row"><button class="btn primary grow" type="button" id="ex-save">保存する</button><button class="btn" type="button" data-close>やめる</button></div>');
  $('#ex-save')!.addEventListener('click', async () => {
    const r = await saveFile(blob, name);
    if (r === 'cancelled') return;
    await store.setSetting('lastExport', Date.now());
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
    '<div class="setting-row"><span class="sub">前に書き出したファイルがあるとき</span><label class="btn" for="ob-file">ファイルから読み込む</label><input type="file" id="ob-file" accept=".zip,application/zip" hidden></div>' +
    '<p class="sub">スマホでは、ブラウザの「ホーム画面に追加」をしてから使ってください。追加しないと、しばらく使わないうちにデータが消えることがあります。</p></section>';
  $('#ob-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = ($('#ob-name') as HTMLInputElement).value.trim() || '旅';
    const start = ($('#ob-start') as HTMLInputElement).value || todayIso();
    const tid = await createTrip(name, start);
    await store.setSetting('currentTrip', tid);
    location.hash = '#plan'; location.reload();
  });
  $('#ob-file')!.addEventListener('change', (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) doImport(f); });
}

// ---------- 設定 ----------
async function settings(current: Trip): Promise<void> {
  const last = await store.getSetting<number>('lastExport');
  let persisted: boolean | null = null; let usage = '';
  try { persisted = (await navigator.storage?.persisted?.()) ?? null; const est = await navigator.storage?.estimate?.(); if (est?.usage) usage = (est.usage / 1024 / 1024).toFixed(1) + 'MB'; } catch { /* 取れない端末もある */ }
  const list = trips();
  sheet('<h2>設定とデータ</h2>' +
    '<section style="display:flex;flex-direction:column;gap:8px"><h3>旅</h3>' + list.map((t) => '<button type="button" class="trip-item" data-st-trip="' + esc(t.id) + '" aria-current="' + (t.id === current.id) + '"><span class="grow"><b>' + esc(t.name) + '</b></span>' + (t.id === current.id ? '<span class="pill booked">表示中</span>' : '<span class="sub">切り替える</span>') + '</button>').join('') +
    '<form id="st-rename" class="row"><input class="i grow" id="st-name" value="' + esc(current.name) + '" aria-label="表示中の旅の名前"><button class="btn" type="submit">名前を変える</button></form>' +
    '<form id="st-new" style="display:flex;flex-direction:column;gap:8px;margin-top:8px"><input class="i" id="st-newname" placeholder="新しい旅の名前" required aria-label="新しい旅の名前"><div class="row"><input class="i grow" id="st-newstart" type="date" value="' + todayIso() + '" aria-label="新しい旅の出発日"><button class="btn" type="submit">新しい旅を作る</button></div></form></section>' +
    '<section style="display:flex;flex-direction:column;gap:4px"><h3>書き出しと読み込み</h3>' +
    '<div class="setting-row"><span class="grow">すべての旅と写真を zip にまとめて保存します<br><span class="sub">最後に書き出した日: ' + (last ? new Date(last).toLocaleDateString('ja-JP') : 'まだありません') + '</span></span><button class="btn primary" type="button" id="st-export">書き出す</button></div>' +
    '<div class="setting-row"><span class="grow">書き出したファイルを読み込みます。同じデータは新しい方を残します</span><label class="btn" for="st-file">読み込む</label><input type="file" id="st-file" accept=".zip,application/zip" hidden></div></section>' +
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
  $('#st-export')!.addEventListener('click', doExport);
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
  if (hasData && (!last || Date.now() - last > REMIND_DAYS * 86400000)) {
    const b = document.createElement('div');
    b.id = 'export-banner'; b.className = 'banner row export-banner';
    b.innerHTML = '<span class="grow">' + (last ? REMIND_DAYS + '日以上書き出していません' : 'まだ一度も書き出していません') + '。端末が壊れたときのために、ときどき書き出してください</span><button class="btn small" type="button" id="banner-export">今書き出す</button>';
    $('#view')!.before(b);
    $('#banner-export')!.addEventListener('click', doExport);
  }

  startApp({ db: scopedDb(store, 'trips/' + tid + '/'), assets: photos });
}

boot().catch((e) => {
  console.error(e);
  $('#view')!.innerHTML = '<div class="empty">データを開けませんでした。ブラウザの設定で、このサイトのデータ保存が止められていないか確認してください。</div>';
});
