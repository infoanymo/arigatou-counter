# ありがとうカウンター

お客様からいただいた「ありがとう」を、チーム全員でリアルタイムに積み上げる管理画面です。

## できること

- 招待制ログイン
- ワンクリックの「ありがとうをもらったよ」登録
- 今期の総数、目標達成率、自分の件数、個人ランキング
- 最近のありがとう履歴
- 管理者による期設定、ありがとう件数調整、ユーザー招待、権限変更、利用停止
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

## GitHub Pages

`.github/workflows/deploy.yml` が `main` ブランチへのpushで `dist` をGitHub Pagesへ公開します。

GitHub ActionsのSecretsに以下を登録してください。

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Hash Routerを使っているため、GitHub PagesのプロジェクトURLでも画面遷移が動きます。
