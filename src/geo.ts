// 地図の座標まわりの計算。画面（app.js）と共有（share.ts）の両方から使う。

const COS = Math.cos(36 * Math.PI / 180);
/** 経度・緯度を地図（japan.json）の座標に直す */
export const PX = (lng: number): number => (lng - 122.5) * COS * 100;
export const PY = (lat: number): number => (45.8 - lat) * 100;

export interface Box { x: number; y: number; w: number; h: number }
export interface LatLng { lat?: unknown; lng?: unknown }

/** 日本全体が入る範囲 */
export const FULL: Box = { x: 0, y: 0, w: 1901, h: 2180 };

/** これより狭くは寄らない（地図の形が粗いので、寄りすぎると島が角ばって見える） */
const MIN_SIZE = 120;

/**
 * 泊まる場所がすべて入る範囲を返す。場所が1つもなければ日本全体。
 * 周りに少し余白を取り、狭すぎるときは MIN_SIZE まで広げる（中心はそのまま）
 */
export function routeBox(points: LatLng[], pad = 0.15): Box {
  const pts = points.filter((p): p is { lat: number; lng: number } => typeof p.lat === 'number' && Number.isFinite(p.lat) && typeof p.lng === 'number' && Number.isFinite(p.lng));
  if (!pts.length) return { ...FULL };
  const xs = pts.map((p) => PX(p.lng)), ys = pts.map((p) => PY(p.lat));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const w = Math.max((x1 - x0) * (1 + pad * 2), MIN_SIZE), h = Math.max((y1 - y0) * (1 + pad * 2), MIN_SIZE);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * 共有するときに座標を丸める。宿や知人宅の場所が分からないよう、
 * 約2km（0.02度）のます目にそろえる。地名の位置が分かれば十分なため
 */
export const SHARE_GRID = 0.02;
export function roundCoord(v: number, grid = SHARE_GRID): number {
  return Math.round(Math.round(v / grid) * grid * 10000) / 10000;
}
