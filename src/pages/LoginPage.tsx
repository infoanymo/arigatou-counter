import { useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { HeartHandshake } from "lucide-react";
import okiariLogo from "../okiari-logo.jpg";
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
      <section className="login-panel" aria-label="ログイン">
        <div className="login-logo-area">
          <img className="login-logo-image" src={okiariLogo} alt="オキアリ" />
          <h1 className="sr-only">オキアリ</h1>
        </div>
        <div className="login-divider" />

        {passwordSetupMode && user ? (
          <>
            <div className="login-copy">
              <p>招待を受け取りました</p>
              <h2>パスワードを設定</h2>
            </div>
            <form className="login-form" onSubmit={handlePasswordSetup}>
              <label className="login-field">
                <span>新しいパスワード</span>
                <input
                  autoComplete="new-password"
                  minLength={8}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  type="password"
                  value={newPassword}
                />
              </label>
              {message ? <p className="form-message">{message}</p> : null}
              <button className="button button-primary" disabled={submitting}>
                {submitting ? "設定中..." : "利用を開始する"}
              </button>
            </form>
          </>
        ) : (
          <>
            <form className="login-form" onSubmit={handleLogin}>
              <label className="login-field">
                <span>ID</span>
                <input
                  autoComplete="email"
                  inputMode="email"
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </label>
              <label className="login-field">
                <span>パスワード</span>
                <input
                  autoComplete="current-password"
                  onChange={(event) => setPasswordValue(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
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
