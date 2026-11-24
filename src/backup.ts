// zip への書き出しと読み込み。
// zip の中身: data.json（データ。消した印のものも含む）と photos/<id>.jpg
// 旅を1つだけ書き出すこともできる（一緒に行く人に、その旅だけを渡すため）
import JSZip from 'jszip';
import type { DocRecord, Store } from './store';

const FORMAT = 'tabicho-backup';
const VERSION = 1;

export async function exportZip(store: Store, tripId?: string): Promise<Blob> {
  const zip = new JSZip();
  const inTrip = (path: string) => !tripId || path === 'trips/' + tripId || path.startsWith('trips/' + tripId + '/');
  const records = store.allRecords().filter((r) => inTrip(r.path));
  zip.file('data.json', JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), records }));
  const folder = zip.folder('photos')!;
  // 旅を1つだけ書き出すときは、その旅の日記にある写真だけを入れる
  const ids = tripId
    ? [...new Set(records.filter((r) => r.col.endsWith('/diary') && r.data && Array.isArray(r.data.photos)).flatMap((r) => r.data!.photos as string[]))]
    : await store.allPhotoIds();
  for (const id of ids) {
    const b = await store.getPhoto(id);
    if (b) folder.file(id + '.jpg', b);
  }
  return await zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

export interface ImportResult { docs: number; photos: number; tripIds: string[] }

export async function importZip(store: Store, file: Blob): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(file);
  const dataFile = zip.file('data.json');
  if (!dataFile) throw new Error('旅帳の書き出しファイルではありません（data.json がありません）');
  const parsed = JSON.parse(await dataFile.async('string')) as { format?: string; version?: number; records?: DocRecord[] };
  if (parsed.format !== FORMAT || !Array.isArray(parsed.records)) throw new Error('旅帳の書き出しファイルではありません');
  const valid = parsed.records.filter((r) => r && typeof r.path === 'string' && typeof r.updatedAt === 'number');
  const docs = await store.merge(valid);
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
