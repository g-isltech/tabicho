# たび帳（tabicho）

日本一周のような長い旅の、行程・予約・お金・やりたいこと・日記を、地図と一緒に管理する Web アプリです。

- サーバーを持ちません。データは使う人の端末のブラウザ（IndexedDB）の中だけに保存します
- スマホでは「ホーム画面に追加」して、アプリのように使います（PWA）
- すべての旅と写真を zip に書き出し・読み込みできます
- 写真は端末の中で縮小してから保存します。撮影場所などの情報はこのとき消えます
- 地名での場所探しにだけ、国土地理院の住所検索を使います（探す言葉だけを送ります）

公開先: https://tabicho.isltech.jp/

## 開発

```sh
npm ci
npm run dev      # 開発用サーバー
npm run build    # 型チェックとビルド（dist/ に出力）
npm run preview  # ビルドしたものを確認
npm test         # 自動テスト（vitest）
```

- TypeScript + Vite。画面の本体（`src/app.js`）は試作版から移したもので、これから少しずつ TypeScript に置き換える
- `src/store.ts`: 端末内の保存（IndexedDB）。消したデータも「消した印」を付けて残す（読み込んだファイルで、消したものが生き返らないようにするため）
- `src/photos.ts`: 写真の縮小と保存
- `src/backup.ts`: zip の書き出し・読み込み（100MB ごとに分ける）
- `src/share.ts`: 旅の記録を人に見せる共有（まとめ画像・見るだけのページ・たび帳で開けるファイル）
- `src/geo.ts`: 地図の座標の計算（ルートに合わせた表示範囲、共有での座標の丸め）
- `scripts/make-sample.mjs`: サンプルの旅（`public/sample-trip.zip`）を作る
- `tests/`: 自動テスト。IndexedDB は fake-indexeddb で置き換えて動かす
- `public/japan.json`: 都道府県の形（地球地図日本（国土地理院）を加工）

## 公開

`main` に push すると、GitHub Actions がテストとビルドをして GitHub Pages に公開します（`.github/workflows/deploy.yml`）。
初回だけ、リポジトリの Settings → Pages で次を設定します。

- Build and deployment の Source を「GitHub Actions」にする
- Custom domain に `tabicho.isltech.jp` を入れ、「Enforce HTTPS」をオンにする（DNS には `tabicho` → `g-isltech.github.io` の CNAME を置く）

ブラウザの中のデータは URL（ドメイン）ごとに分かれて保存されます。公開先のドメインを変えると、利用者は書き出しと読み込みでデータを移す必要があるので、むやみに変えないこと。

## これからやること

1. ~~端末内の保存だけで動く版~~
2. ~~旅の記録を人に見せる共有~~
3. 一般公開の準備（プライバシーポリシーなど）

## 出典

- 地図: 地球地図日本（国土地理院）を加工して作成
- 場所の検索: 国土地理院 住所検索 API
