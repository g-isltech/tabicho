// テスト用の下準備。
// - IndexedDB は fake-indexeddb で用意する（テストごとに空にする）
// - JSZip は Blob を読むときに FileReader を使うが、Node にはないので最小限のものを用意する
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach } from 'vitest';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

if (!('FileReader' in globalThis)) {
  class MiniFileReader {
    result: ArrayBuffer | string | null = null;
    error: unknown = null;
    onload: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onloadend: ((e: unknown) => void) | null = null;
    private run(p: Promise<ArrayBuffer | string>) {
      p.then((r) => { this.result = r; this.onload?.({ target: this }); this.onloadend?.({ target: this }); })
        .catch((e) => { this.error = e; this.onerror?.({ target: this }); this.onloadend?.({ target: this }); });
    }
    readAsArrayBuffer(b: Blob) { this.run(b.arrayBuffer()); }
    readAsText(b: Blob) { this.run(b.text()); }
  }
  (globalThis as unknown as { FileReader: unknown }).FileReader = MiniFileReader;
}
