import { useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { HeartHandshake, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";

function isPasswordSetupMode(search: string) {
  const params = new URLSearchParams(search);
  return (
    params.get("mode") === "set-password" ||
    window.location.href.includes("type=invite") ||
    window.location.href.includes("type=recovery")
  );
}

export function LoginPage() {
  const { user, profile, loading, signIn, setPassword, refreshAuth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPasswordValue] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const passwordSetupMode = useMemo(
    () => isPasswordSetupMode(location.search),
    [location.search],
  );

  if (!isSupabaseConfigured) {
    return (
      <main className="center-screen setup-screen">
        <section className="setup-panel">
          <div className="brand-lockup">
            <span className="brand-mark">
              <HeartHandshake aria-hidden="true" />
            </span>
            <div>
              <p className="eyebrow">初期設定</p>
              <h1>Supabaseの接続情報を設定してください</h1>
            </div>
          </div>
          <p>
            `.env.local` に `VITE_SUPABASE_URL` と
            `VITE_SUPABASE_PUBLISHABLE_KEY` を入れるとログインできます。
          </p>
        </section>
      </main>
    );
  }

  if (!loading && user && profile?.status !== "disabled" && !passwordSetupMode) {
    return <Navigate to="/" replace />;
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      await signIn(email.trim(), password);
      navigate("/", { replace: true });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ログインできませんでした。入力内容を確認してください。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasswordSetup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      await setPassword(newPassword);
      await refreshAuth();
      navigate("/", { replace: true });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "パスワードを設定できませんでした。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-hero" aria-label="サービス紹介">
        <div className="brand-lockup">
          <span className="brand-mark">
            <HeartHandshake aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">Customer Thanks Tracker</p>
            <h1>ありがとうカウンター</h1>
          </div>
        </div>
        <p>
          お客様から届いた「ありがとう」を、チーム全員で同じ数字として見られる管理画面です。
        </p>
        <div className="hero-metrics" aria-label="画面の雰囲気">
          <span>今期目標</span>
          <strong>10,000</strong>
          <span>リアルタイム更新</span>
        </div>
      </section>

      <section className="login-panel">
        {passwordSetupMode && user ? (
          <>
            <div className="panel-heading">
              <Sparkles aria-hidden="true" />
              <div>
                <p className="eyebrow">招待を受け取りました</p>
                <h2>パスワードを設定</h2>
              </div>
            </div>
            <form className="form-stack" onSubmit={handlePasswordSetup}>
              <label>
                <span>新しいパスワード</span>
                <div className="input-shell">
                  <LockKeyhole aria-hidden="true" />
                  <input
                    autoComplete="new-password"
                    minLength={8}
                    onChange={(event) => setNewPassword(event.target.value)}
                    required
                    type="password"
                    value={newPassword}
                  />
                </div>
              </label>
              {message ? <p className="form-message">{message}</p> : null}
              <button className="button button-primary" disabled={submitting}>
                {submitting ? "設定中..." : "利用を開始する"}
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="panel-heading">
              <LockKeyhole aria-hidden="true" />
              <div>
                <p className="eyebrow">ログイン</p>
                <h2>アカウントで入る</h2>
              </div>
            </div>
            <form className="form-stack" onSubmit={handleLogin}>
              <label>
                <span>メールアドレス</span>
                <div className="input-shell">
                  <Mail aria-hidden="true" />
                  <input
                    autoComplete="email"
                    inputMode="email"
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    type="email"
                    value={email}
                  />
                </div>
              </label>
              <label>
                <span>パスワード</span>
                <div className="input-shell">
                  <LockKeyhole aria-hidden="true" />
                  <input
                    autoComplete="current-password"
                    onChange={(event) => setPasswordValue(event.target.value)}
                    required
                    type="password"
                    value={password}
                  />
                </div>
              </label>
              {message ? <p className="form-message">{message}</p> : null}
              <button className="button button-primary" disabled={submitting}>
                {submitting ? "ログイン中..." : "ログイン"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
