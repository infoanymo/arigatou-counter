# ありがとうカウンター

お客様からいただいた「ありがとう」を、チーム全員でリアルタイムに積み上げる管理画面です。

## できること

- 招待制ログイン
- ワンクリックの「ありがとうをもらったよ」登録
- 今期の総数、目標達成率、自分の件数、個人ランキング
- 最近のありがとう履歴
- 管理者による期設定、ありがとう件数調整、ユーザー招待、権限変更、利用停止
- 管理者によるChatwork連携設定と月次ありがとう集計通知
- Supabase Realtimeによる全員の画面への即時反映

## ローカル起動

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

`.env.local` にはSupabaseの公開用接続情報を設定します。

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

## Supabase設定

1. Supabaseで新規プロジェクトを作成します。
2. SQL Editorで `supabase/schema.sql` を実行します。
3. Authenticationの最初の管理者ユーザーを作成します。
4. そのユーザーの `app_metadata` に `{"role":"admin"}` を設定します。
   設定後、管理者ユーザーは一度ログアウトして再ログインしてください。
5. Edge Function `admin-users` をデプロイします。
6. Edge Functionに `SUPABASE_SECRET_KEY` または `SUPABASE_SERVICE_ROLE_KEY` を設定します。
7. 招待メールのリダイレクト先として、公開URLをSupabase AuthのAllowed Redirect URLsに追加します。

Edge Function側の任意環境変数として `APP_URL` を設定すると、招待メールの戻り先を固定できます。

## Chatwork月次通知

管理画面の「管理 > チャットワーク連携」でChatwork APIトークン、送信先ルーム、ルームごとの本文テンプレートを保存できます。APIトークンは画面に再表示せず、Edge Function経由でのみ使用します。

本文テンプレートでは以下の置換タグを使えます。

- `{{cumulativeTotal}}`: 累計ありがとう
- `{{monthlyTotal}}`: 対象月のありがとう
- `{{targetMonth}}`: 対象月の表示名（例: 7月）
- `{{targetMonthStart}}`: 対象月の開始日（例: 2026-07-01）

Supabase側では以下を設定してください。

1. SQL Editorで `supabase/schema.sql` の最新版を実行します。
   既存環境へ今回のChatwork複数ルーム対応だけを反映する場合は、代わりに `supabase/chatwork-multi-room-migration.sql` を実行できます。
2. Edge Function `chatwork-notification` をデプロイします。
   `supabase/config.toml` で `verify_jwt = false` にしていますが、Function内部で管理者JWTまたはサービスキーを検証します。
3. `supabase/chatwork-cron.sql` の `PASTE_SUPABASE_SERVICE_ROLE_OR_SECRET_KEY_HERE` をSupabaseのサービスキーに置き換えて、SQL Editorで実行します。

月次Cronは `0 0 3 * *` UTC、つまり毎月3日9:00 JSTに動きます。送信対象は前月分です。

## 招待メールの日本語テンプレート

Supabase DashboardのAccount > Access Tokensでアクセストークンを発行し、以下を実行するとHosted projectの招待メールテンプレートを日本語に更新できます。

```bash
SUPABASE_ACCESS_TOKEN=your-access-token pnpm supabase:email:invite
```

テンプレート本文は `supabase/templates/invite.html` にあります。

新規FreeプランのプロジェクトでSupabaseのデフォルトSMTPを使っている場合、AuthメールテンプレートのカスタマイズにはCustom SMTP設定が必要になることがあります。

## GitHub Pages

`.github/workflows/deploy.yml` が `main` ブランチへのpushで `dist` をGitHub Pagesへ公開します。

GitHub ActionsのSecretsに以下を登録してください。

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Hash Routerを使っているため、GitHub PagesのプロジェクトURLでも画面遷移が動きます。
