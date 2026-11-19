// 写真は端末の中で縮小してから保存する。
// 描き直して JPEG にするので、撮影場所などの情報（EXIF）はここで消える。
import { newId, type Store } from './store';

const MAX_EDGE = 1600;
const QUALITY = 0.82;

export async function shrink(file: Blob): Promise<Blob> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await createImageBitmap(file); }
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas not available');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return await new Promise<Blob>((ok, ng) => canvas.toBlob((b) => (b ? ok(b) : ng(new Error('encode failed'))), 'image/jpeg', QUALITY));
}

export class Photos {
  private urls = new Map<string, string>();
  constructor(private store: Store) {}

  /** アーティファクト版の assets と同じ形: upload は {id} を返す */
  async upload(file: Blob): Promise<{ id: string }> {
    const blob = await shrink(file);
    const id = 'p' + newId();
    await this.store.putPhoto(id, blob);
    this.urls.set(id, URL.createObjectURL(blob));
    return { id };
  }

  async delete(id: string): Promise<void> {
    await this.store.deletePhoto(id);
    const u = this.urls.get(id); if (u) URL.revokeObjectURL(u);
    this.urls.delete(id);
  }

  /** 表示前に読み込んでおく。読み込み済みなら何もしない */
  async preload(ids: string[]): Promise<boolean> {
    let added = false;
    for (const id of ids) {
      if (!id || this.urls.has(id)) continue;
      const b = await this.store.getPhoto(id);
      this.urls.set(id, b ? URL.createObjectURL(b) : '');
      added = true;
    }
    return added;
  }

  src(id: string): string { return this.urls.get(id) || ''; }
}
