# アイコン

- シリーズ（たび帳・みち帳）で同じ型にする。色の地に白い記号を大きく置き、右上の黄色い栞をシリーズの印にする
- `make-icons.py` で SVG を作る（`python3 make-icons.py`）。たび帳は `plan-symbol.svg` を `public/icon.svg` に使う
- PNG（`public/icon-192.png`・`icon-512.png`・`maskable-512.png`・`apple-touch-icon.png`）は SVG をブラウザで描いて書き出した
  - `apple-touch-icon.png` と `maskable-512.png` は角を丸めない（端末が丸める）。マスク用は記号を少し小さくして、中央80%に収める
