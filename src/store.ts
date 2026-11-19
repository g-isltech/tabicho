// 端末内（IndexedDB）に保存するデータストア。
// 画面側のコードはアーティファクト版の db（doc / collection / onSnapshot）と同じ形で呼べるようにしてある。
// 消したデータも「deleted」として残す。あとで Google ドライブと同期するとき、どちらで消したかを比べるため。
import { openDB, type IDBPDatabase } from 'idb';

export type Data = Record<string, unknown>;

export interface DocRecord {
  path: string; // 例: trips/t1/stops/s01
  col: string; // 例: trips/t1/stops
  id: string;
  data: Data | null;
  updatedAt: number;
  deleted: boolean;
}

export interface PhotoRecord {
  id: string;
  blob: Blob;
  createdAt: number;
}

export interface DocSnapshot {
  id: string;
  exists: boolean;
  data(): Data | undefined;
}
export interface QuerySnapshot {
  docs: DocSnapshot[];
  size: number;
  empty: boolean;
}

type Listener = () => void;

const DB_NAME = 'tabicho';
const DB_VERSION = 1;

export class Store {
  private db!: IDBPDatabase;
  private docs = new Map<string, DocRecord>();
  private colListeners = new Map<string, Set<Listener>>();
  private docListeners = new Map<string, Set<Listener>>();
  private anyListeners = new Set<Listener>();

  async open(): Promise<void> {
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const docs = db.createObjectStore('docs', { keyPath: 'path' });
        docs.createIndex('col', 'col');
        db.createObjectStore('photos', { keyPath: 'id' });
        db.createObjectStore('settings');
      }
    });
    const all = (await this.db.getAll('docs')) as DocRecord[];
    all.forEach((r) => this.docs.set(r.path, r));
  }

  // ---- 低レベルの操作 ----
  read(path: string): Data | undefined {
    const r = this.docs.get(path);
    return r && !r.deleted && r.data ? r.data : undefined;
  }

  list(col: string): DocRecord[] {
    const out: DocRecord[] = [];
    this.docs.forEach((r) => { if (r.col === col && !r.deleted) out.push(r); });
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** 全件（消した印のものも含む）。書き出しと同期に使う */
  allRecords(): DocRecord[] { return [...this.docs.values()]; }

  async write(path: string, data: Data | null, updatedAt = Date.now()): Promise<void> {
    const parts = path.split('/');
    if (parts.length % 2 !== 0) throw new Error('document path must have an even number of segments: ' + path);
    const rec: DocRecord = { path, col: parts.slice(0, -1).join('/'), id: parts[parts.length - 1], data, updatedAt, deleted: data === null };
    this.docs.set(path, rec);
    await this.db.put('docs', rec);
    this.emit(rec.col, path);
  }

  /** 書き出したファイルなどから取り込む。新しい方を残す */
  async merge(records: DocRecord[]): Promise<number> {
    let n = 0;
    const tx = this.db.transaction('docs', 'readwrite');
    const cols = new Set<string>();
    for (const r of records) {
      const cur = this.docs.get(r.path);
      if (cur && cur.updatedAt >= r.updatedAt) continue;
      this.docs.set(r.path, r); await tx.store.put(r); cols.add(r.col); n++;
    }
    await tx.done;
    cols.forEach((c) => this.emit(c, null));
    return n;
  }

  async removeTrip(prefix: string): Promise<void> {
    const tx = this.db.transaction('docs', 'readwrite');
    for (const [path, r] of this.docs) {
      if (path.startsWith(prefix)) { const d = { ...r, data: null, deleted: true, updatedAt: Date.now() }; this.docs.set(path, d); await tx.store.put(d); }
    }
    await tx.done;
    this.anyListeners.forEach((f) => f());
  }

  // ---- 写真 ----
  async putPhoto(id: string, blob: Blob): Promise<void> { await this.db.put('photos', { id, blob, createdAt: Date.now() } satisfies PhotoRecord); }
  async getPhoto(id: string): Promise<Blob | undefined> { const r = (await this.db.get('photos', id)) as PhotoRecord | undefined; return r?.blob; }
  async deletePhoto(id: string): Promise<void> { await this.db.delete('photos', id); }
  async allPhotoIds(): Promise<string[]> { return (await this.db.getAllKeys('photos')) as string[]; }

  // ---- 設定（端末ごと） ----
  async getSetting<T>(key: string): Promise<T | undefined> { return (await this.db.get('settings', key)) as T | undefined; }
  async setSetting(key: string, value: unknown): Promise<void> { await this.db.put('settings', value, key); }

  // ---- 変更の通知 ----
  private emit(col: string, path: string | null): void {
    this.colListeners.get(col)?.forEach((f) => f());
    if (path) this.docListeners.get(path)?.forEach((f) => f());
    else this.docListeners.forEach((set, p) => { if (p.startsWith(col + '/')) set.forEach((f) => f()); });
    this.anyListeners.forEach((f) => f());
  }
  onCol(col: string, f: Listener): () => void { return addTo(this.colListeners, col, f); }
  onDoc(path: string, f: Listener): () => void { return addTo(this.docListeners, path, f); }
  onAny(f: Listener): () => void { this.anyListeners.add(f); return () => this.anyListeners.delete(f); }
}

function addTo(map: Map<string, Set<Listener>>, key: string, f: Listener): () => void {
  let s = map.get(key); if (!s) { s = new Set(); map.set(key, s); }
  s.add(f); return () => s!.delete(f);
}

let seq = 0;
export function newId(): string {
  seq = (seq + 1) % 1296;
  return Date.now().toString(36) + seq.toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 6);
}

// ---- アーティファクト版と同じ形の db（旅ごとのパスの前に付ける） ----
export interface DocRef {
  id: string;
  path: string;
  get(): Promise<DocSnapshot>;
  set(data: Data): Promise<void>;
  update(data: Data): Promise<void>;
  delete(): Promise<void>;
  onSnapshot(next: (s: DocSnapshot) => void, err?: (e: unknown) => void): () => void;
}
export interface ColRef {
  path: string;
  doc(id?: string): DocRef;
  add(data: Data): Promise<DocRef>;
  onSnapshot(next: (s: QuerySnapshot) => void, err?: (e: unknown) => void): () => void;
}
export interface ScopedDb {
  doc(path: string): DocRef;
  collection(path: string): ColRef;
}

function snap(store: Store, path: string): DocSnapshot {
  const d = store.read(path);
  const id = path.split('/').pop() || '';
  return { id, exists: !!d, data: () => (d ? structuredClone(d) : undefined) };
}

export function scopedDb(store: Store, prefix: string): ScopedDb {
  const docRef = (full: string): DocRef => ({
    id: full.split('/').pop() || '',
    path: full,
    async get() { return snap(store, full); },
    async set(data) { await store.write(full, structuredClone(data)); },
    async update(data) {
      const cur = store.read(full);
      if (!cur) throw Object.assign(new Error('not found'), { code: 'invalid_argument' });
      await store.write(full, deepMerge(structuredClone(cur), structuredClone(data)));
    },
    async delete() { if (store.read(full)) await store.write(full, null); },
    onSnapshot(next) { const fire = () => next(snap(store, full)); queueMicrotask(fire); return store.onDoc(full, fire); }
  });
  const colRef = (full: string): ColRef => ({
    path: full,
    doc(id?: string) { return docRef(full + '/' + (id || newId())); },
    async add(data) { const r = docRef(full + '/' + newId()); await r.set(data); return r; },
    onSnapshot(next) {
      const fire = () => {
        const docs = store.list(full).map((r) => snap(store, r.path));
        next({ docs, size: docs.length, empty: !docs.length });
      };
      queueMicrotask(fire);
      return store.onCol(full, fire);
    }
  });
  return {
    doc: (p) => docRef(prefix + p),
    collection: (p) => colRef(prefix + p)
  };
}

function deepMerge(base: Data, patch: Data): Data {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      base[k] = deepMerge(base[k] as Data, v as Data);
    } else base[k] = v;
  }
  return base;
}
