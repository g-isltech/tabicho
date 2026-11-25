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

const THUMB_EDGE = 320;

/** 一覧用の小さな写真を作る */
export async function makeThumb(blob: Blob): Promise<Blob> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(blob, { resizeWidth: THUMB_EDGE, resizeQuality: 'medium' }); } catch { bmp = await createImageBitmap(blob); }
  const k = Math.min(1, THUMB_EDGE / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k));
  const ctx = cv.getContext('2d'); if (!ctx) throw new Error('canvas not available');
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close();
  return await new Promise<Blob>((ok, ng) => cv.toBlob((b) => (b ? ok(b) : ng(new Error('encode failed'))), 'image/jpeg', 0.75));
}

/**
 * 写真の保存と表示。
 * - 保存するときに、元の写真（長い辺1600px）と一覧用の小さな写真（320px）を両方作る
 * - 一覧（日記・写真選び）には小さな写真だけを、画面に見えてきたものから読み込む
 * - 元の大きさは「大きく見る」ときだけ読み込み、最近の数枚だけを覚えておく
 */
export class Photos {
  private thumbs = new Map<string, string>();
  private fulls = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  private queue: HTMLImageElement[] = [];
  private running = 0;
  constructor(private store: Store) {}

  /** アーティファクト版の assets と同じ形: upload は {id} を返す */
  async upload(file: Blob): Promise<{ id: string }> {
    const blob = await shrink(file);
    let thumb: Blob | undefined;
    try { thumb = await makeThumb(blob); } catch { /* 作れなくても、表示するときに作り直す */ }
    const id = 'p' + newId();
    await this.store.putPhoto(id, blob, thumb);
    return { id };
  }

  async delete(id: string): Promise<void> {
    await this.store.deletePhoto(id);
    for (const m of [this.thumbs, this.fulls]) { const u = m.get(id); if (u) URL.revokeObjectURL(u); m.delete(id); }
  }

  /** 一覧用の小さな写真の URL。前の版で入れた写真は、ここで作って保存しておく */
  thumb(id: string): Promise<string> {
    const hit = this.thumbs.get(id); if (hit) return Promise.resolve(hit);
    const p = this.pending.get(id); if (p) return p;
    const job = (async () => {
      let t = await this.store.getThumb(id);
      if (!t) {
        const full = await this.store.getPhoto(id); if (!full) return '';
        t = await makeThumb(full);
        await this.store.setThumb(id, t);
      }
      const u = URL.createObjectURL(t); this.thumbs.set(id, u); return u;
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, job); return job;
  }

  /** 元の大きさの写真の URL。メモリを使いすぎないよう、最近の3枚だけ覚えておく */
  async full(id: string): Promise<string> {
    const hit = this.fulls.get(id); if (hit) { this.fulls.delete(id); this.fulls.set(id, hit); return hit; }
    const b = await this.store.getPhoto(id); if (!b) return '';
    const u = URL.createObjectURL(b); this.fulls.set(id, u);
    while (this.fulls.size > 3) { const [k, v] = this.fulls.entries().next().value as [string, string]; URL.revokeObjectURL(v); this.fulls.delete(k); }
    return u;
  }

  /**
   * container の中の <img data-thumb="写真のID"> に、画面に見えてきたものから小さな写真を入れる（同時に3枚まで）。
   * root にはスクロールする箱（編集画面など）を渡す。渡さなければ画面全体
   */
  lazy(container: Element, root: Element | null = null): () => void {
    const imgs = [...container.querySelectorAll<HTMLImageElement>('img[data-thumb]')].filter((i) => !i.getAttribute('src'));
    // 覚えている写真は、すぐに入れる
    const rest = imgs.filter((i) => { const u = this.thumbs.get(i.dataset.thumb!); if (u) { i.src = u; return false; } return true; });
    if (!rest.length) return () => {};
    const io = new IntersectionObserver((ents) => ents.forEach((e) => {
      if (!e.isIntersecting) return; const img = e.target as HTMLImageElement; io.unobserve(img); this.queue.push(img); this.pump();
    }), { root, rootMargin: '400px 0px' });
    rest.forEach((i) => io.observe(i));
    return () => io.disconnect();
  }

  private pump(): void {
    while (this.running < 3 && this.queue.length) {
      const img = this.queue.shift()!;
      if (!img.isConnected) continue;
      this.running++;
      this.thumb(img.dataset.thumb!).then((u) => { if (u) img.src = u; }).catch(() => {}).finally(() => { this.running--; this.pump(); });
    }
  }
}
