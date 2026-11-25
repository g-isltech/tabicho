// zip への書き出しと読み込み。
// zip の中身: data.json（データ。消した印のものも含む）と photos/<id>.jpg
// 旅を1つだけ書き出すこともできる（一緒に行く人に、その旅だけを渡すため）
import JSZip from 'jszip';
import type { DocRecord, Store } from './store';

const FORMAT = 'tabicho-backup';
const VERSION = 1;

/**
 * 1つの zip の大きさの上限。古めの iPhone でも、メモリが足りずに落ちないよう 100MB にする。
 * 写真がこれを超えるときは、写真だけの zip に分ける（写真 300〜400枚ぶんで1つ）。
 */
export const PART_LIMIT = 100 * 1024 * 1024;
const PHOTO_PART = 'tabicho-backup-photos';

export interface ExportPlan {
  records: DocRecord[];
  parts: { photoIds: string[]; bytes: number }[];
}

/**
 * 書き出しの計画を立てる。写真の大きさを足していき、上限を超えたら次のファイルに回す。
 * withPhotos が false なら「データだけ」（写真なし）の1ファイルにする
 */
export async function planExport(store: Store, tripId?: string, withPhotos = true, limit = PART_LIMIT): Promise<ExportPlan> {
  const inTrip = (path: string) => !tripId || path === 'trips/' + tripId || path.startsWith('trips/' + tripId + '/');
  const records = store.allRecords().filter((r) => inTrip(r.path));
  const dataBytes = new Blob([JSON.stringify(records)]).size;
  const parts: ExportPlan['parts'] = [{ photoIds: [], bytes: dataBytes }];
  if (!withPhotos) return { records, parts };
  // 旅を1つだけ書き出すときは、その旅の日記にある写真だけを入れる
  const ids = tripId
    ? [...new Set(records.filter((r) => !r.deleted && r.col.endsWith('/diary') && r.data && Array.isArray(r.data.photos)).flatMap((r) => r.data!.photos as string[]))]
    : await store.allPhotoIds();
  for (const id of ids) {
    const b = await store.getPhoto(id); if (!b) continue;
    let cur = parts[parts.length - 1];
    if (cur.bytes + b.size > limit && cur.photoIds.length) { cur = { photoIds: [], bytes: 0 }; parts.push(cur); }
    cur.photoIds.push(id); cur.bytes += b.size;
  }
  return { records, parts };
}

/** 計画の i 番目のファイルを作る。1つ目にはデータ（data.json）を入れ、2つ目からは写真だけ */
export async function buildPart(store: Store, plan: ExportPlan, i: number): Promise<Blob> {
  const zip = new JSZip();
  const total = plan.parts.length;
  if (i === 0) zip.file('data.json', JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), parts: total, records: plan.records }));
  else zip.file('part.json', JSON.stringify({ format: PHOTO_PART, version: VERSION, part: i + 1, parts: total, exportedAt: new Date().toISOString() }));
  const folder = zip.folder('photos')!;
  for (const id of plan.parts[i].photoIds) { const b = await store.getPhoto(id); if (b) folder.file(id + '.jpg', b); }
  return await zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

/** これまでどおり1つの zip にまとめる（分ける必要がないとき用） */
export async function exportZip(store: Store, tripId?: string): Promise<Blob> {
  const plan = await planExport(store, tripId, true, Number.MAX_SAFE_INTEGER);
  return await buildPart(store, plan, 0);
}

export interface ImportResult { docs: number; photos: number; tripIds: string[] }

export async function importZip(store: Store, file: Blob): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(file);
  const dataFile = zip.file('data.json');
  const partFile = zip.file('part.json');
  let valid: DocRecord[] = [];
  let docs = 0;
  if (dataFile) {
    const parsed = JSON.parse(await dataFile.async('string')) as { format?: string; version?: number; records?: DocRecord[] };
    if (parsed.format !== FORMAT || !Array.isArray(parsed.records)) throw new Error('たび帳の書き出しファイルではありません');
    valid = parsed.records.filter((r) => r && typeof r.path === 'string' && typeof r.updatedAt === 'number');
    docs = await store.merge(valid);
  } else if (partFile) {
    // 写真だけのファイル（分けて書き出したものの2つ目以降）
    const part = JSON.parse(await partFile.async('string')) as { format?: string };
    if (part.format !== PHOTO_PART) throw new Error('たび帳の書き出しファイルではありません');
  } else throw new Error('たび帳の書き出しファイルではありません');
  let photos = 0;
  const have = new Set(await store.allPhotoIds());
  const files = zip.folder('photos')?.file(/\.jpg$/) || [];
  for (const f of files) {
    const id = f.name.replace(/^photos\//, '').replace(/\.jpg$/, '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || have.has(id)) continue;
    const b = await f.async('blob');
    await store.putPhoto(id, new Blob([b], { type: 'image/jpeg' }));
    photos++;
  }
  // ファイルに入っていた旅（消した印のものは除く）。読み込んだあと、その旅を表示するために使う
  const tripIds = valid.filter((r) => r.col === 'trips' && !r.deleted).map((r) => r.id);
  return { docs, photos, tripIds };
}

/**
 * ファイルを端末に保存する。
 * iPhone のホーム画面から開いたアプリでは、ふつうのダウンロードが動かないことがあるため、
 * 共有シート（「ファイルに保存」を選べる）が使えるときはそちらを使う。
 * 共有シートは、ボタンを押した直後に呼ぶ必要がある。
 */
export async function saveFile(blob: Blob, filename: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type || 'application/zip' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  // パソコンでは、ふつうのダウンロードの方が分かりやすいので、指で操作する端末のときだけ共有シートを使う
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && nav.canShare && nav.share && nav.canShare({ files: [file] })) {
    try { await nav.share({ files: [file], title: filename }); return 'shared'; }
    catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'; }
  }
  saveBlob(blob, filename);
  return 'downloaded';
}

export function saveBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}
