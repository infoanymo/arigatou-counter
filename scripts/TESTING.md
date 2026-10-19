# 回帰テスト

Node.js 24以降で、日付・数値入力・ページ分割のテストを実行できます。

```sh
node --test scripts/analytics.test.ts scripts/data-regressions.test.ts scripts/abortable-request.test.ts
```

画面テストは本番データやネットワークを使わず、Reactとメモリ内のAPI再現データで実行します。
別の一時ディレクトリに `jsdom@30.1.2` と `esbuild@0.28.2` をインストールし、
その `node_modules` の絶対パスを指定してください。

```sh
QA_DEPENDENCIES=/absolute/path/to/node_modules node --test scripts/ui-regressions.test.mjs
```

画面テストでは、数値の誤変換、期設定の保存表示、30件を超える補正、
全体投稿の削除一覧への混入、履歴追加時のコメント・リアクション、
更新時の履歴保持、50件を超えるお客様のお声を検証します。

期間集計では、完了表示、プロフィール取得への非依存、過去月の適用、
通信が応答しない場合の30秒のタイムアウトと再試行、失敗を0件として表示しないことも検証します。
