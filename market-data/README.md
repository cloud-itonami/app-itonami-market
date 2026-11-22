# 営 市場情報

BTC、ETH、SOL を時価総額順で表示する静的な営 dApp。価格・時価総額・24 時間出来高は USD、流通供給量は各銘柄の数量。価格履歴は過去 30 日の観測点をグラフとデータ表で表示する。出典は CoinGecko。市場一覧と履歴の出典 URL、銘柄ごとの観測時刻、データセットの取得時刻を UTC で確認できる。

## 公開版

[営 市場情報](https://cloud-itonami.github.io/app-itonami-market/)。

**今は使えない機能（2026-11-22、restricted-wasm-v1 への移行による）**

- **CID でスナップショットを開く操作と、「動作確認用サンプルを開く」**: 使えない。Yataverse（yataverse.com）を運営する事業者が確定しておらず、外部への送信として宣言していないため（KOTOBA-159）。
- **「JSON を保存」**: 使えない。app は sandbox の中で動き、そこから利用者にファイルを渡す口が、共通の runtime にまだないため（KOTOBA-968）。
- ローカルの JSON ファイルを開くことと、CoinGecko からの市場データと価格履歴の取得は使える。

送り先が確定するか、書き出しの口ができたら、ここを書き直す。

## 起動と確認

リポジトリ直下から Node.js 22 以上で実行する。

```sh
node market-data/build.mjs
node --test market-data/*.test.mjs
node market-data/verify-browser.mjs   # 本物の Chrome で確かめる（ネットワークを使う）
python3 -m http.server 4173 --bind 127.0.0.1 --directory market-data/dist
```

`http://localhost:4173/` を開き、「市場データを取得」を選ぶ。「履歴を取得」で選択銘柄の履歴を追加する。各取得は共通ランタイムの確認画面で許可する。API の利用条件・上限・障害で取得が失敗した場合は画面に表示される。公開鍵・API キー・バックグラウンド通信は不要。テストは合成値を使用し、アプリは未取得値を合成データで補わない。

## データとストレージの境界

- 出典は CoinGecko [市場一覧](https://docs.coingecko.com/reference/coins-markets) と [価格履歴](https://docs.coingecko.com/reference/coins-id-market-chart)。市場一覧の `current_price`、`circulating_supply`、`market_cap`、`total_volume` を個別に採用する。不明は不明と表示する。供給量や時価総額をほかの値から逆算しない。履歴は出典の UTC 観測点を採用する。
- `itonami.market-snapshot.v1` は UTF-8 JSON の公開スナップショット。版、通貨、出典、取得時刻、銘柄別の観測・指標・任意の履歴をまとめる。正規化して保存したバイト列は、Awai FS と Yataverse が扱う CIDv1 / raw / sha2-256 の 1 ブロックになる。JSON 保存・ローカル読み込みに対応する。公開の CID 取得は Yataverse の `GET /ipfs/<cid>?format=raw` を使い、256 KiB 以下かつ指定 CID と一致したバイト列だけを解析する。CID は内容の同一性を検証する。ファイルの出典表記は作成者の申告であり、発行者の署名や独立した価格検証は含まれない。
- 保存した JSON は対応する Awai FS ファイル保管先へ置ける。再配布の権利を確認済みのスナップショットは、権限のある運用者が既存の [Yataverse CLI](https://github.com/network-awai/app-itonami-yataverse) の `yataverse put <file>` で公開できる。先に [出典の利用条件](https://www.coingecko.com/en/api_terms) を確認する。MVP のアプリ権限は読み取りのみ。Yataverse のブラウザ読み取りには、配布元の HTTPS オリジンをゲートウェイの読み取り CORS に登録する必要がある。
- アプリ配信元の役割は静的ファイル配布。ブラウザが出典・Yataverse に直接接続して検証・表示し、現在のビューの状態をメモリに保持する。公開データの 1 ブロックを対象とするため、WNFS の個人データ、Kotobase の索引、Kura 保持契約、定期採取と最新 CID の発見はこの版の範囲外。
- ビルド時に正本の Kotoba ブラウザランタイムと同意スタイルを固定 commit から取り込み、SHA-256 に照合する。配布ディレクトリには検証済みの正本、`descriptor.json`、静的 CSP、ファイル別ハッシュを持つ `release.json` が入る。実際に許可するメソッド・パス・クエリは descriptor とアプリの CID 形式検証で限定する。

既存の注文向け appview とは別のビルドとエントリ。関連する契約は [AWAI-3386](https://linear.app/kotobalabs/issue/AWAI-3386)、実アプリの WNFS/Kotobase 接続は [AWAI-3390](https://linear.app/kotobalabs/issue/AWAI-3390)。
