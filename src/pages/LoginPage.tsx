import { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, HeartHandshake } from "lucide-react";
import okiariLogo from "../okiari-logo-clean.jpg";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";

function isPasswordSetupMode(search: string) {
  const params = new URLSearchParams(search);
  const pageParams = new URLSearchParams(window.location.search);

  return (
    params.get("mode") === "set-password" ||
    pageParams.get("mode") === "set-password" ||
    window.location.href.includes("type=invite") ||
    window.location.href.includes("type=recovery")
  );
}

function PasswordSetupLoading() {
  return (
    <main className="center-screen">
      <div className="loader-panel">
        <div className="pulse-mark" />
        <p>招待リンクを確認しています</p>
      </div>
    </main>
  );
}

function clearPasswordSetupUrl() {
  window.history.replaceState(
    null,
    "",
    `${window.location.origin}${window.location.pathname}#/`,
  );
}

const maxPasswordSetupRecoveryAttempts = 6;

export function LoginPage() {
  const {
    user,
    profile,
    loading,
    authMessage,
    signIn,
    setPassword,
    refreshAuth,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPasswordValue] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [passwordSetupRecoveryAttempts, setPasswordSetupRecoveryAttempts] =
    useState(0);

  const passwordSetupMode = useMemo(
    () => isPasswordSetupMode(location.search),
    [location.search],
  );
  const recoveringPasswordSetup =
    passwordSetupMode &&
    !user &&
    (loading ||
      passwordSetupRecoveryAttempts < maxPasswordSetupRecoveryAttempts);
  const passwordSetupUnavailable =
    passwordSetupMode &&
    !loading &&
    !user &&
    passwordSetupRecoveryAttempts >= maxPasswordSetupRecoveryAttempts;

  useEffect(() => {
    if (!passwordSetupMode) {
      setPasswordSetupRecoveryAttempts(0);
    }
  }, [passwordSetupMode]);

  useEffect(() => {
    if (
      !passwordSetupMode ||
      user ||
      loading ||
      passwordSetupRecoveryAttempts >= maxPasswordSetupRecoveryAttempts
    ) {
      return undefined;
    }

    const timeout = window.setTimeout(
      () => {
        setPasswordSetupRecoveryAttempts((current) => current + 1);
        void refreshAuth();
      },
      passwordSetupRecoveryAttempts === 0 ? 50 : 500,
    );

    return () => window.clearTimeout(timeout);
  }, [
    loading,
    passwordSetupMode,
    passwordSetupRecoveryAttempts,
    refreshAuth,
    user,
  ]);

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

  if (recoveringPasswordSetup) {
    return <PasswordSetupLoading />;
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
      clearPasswordSetupUrl();
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
                <span className="password-input-wrap">
                  <input
                    autoComplete="new-password"
                    minLength={8}
                    onChange={(event) => setNewPassword(event.target.value)}
                    required
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                  />
                  <button
                    aria-label={
                      showNewPassword
                        ? "パスワードを非表示にする"
                        : "パスワードを表示する"
                    }
                    aria-pressed={showNewPassword}
                    className="password-visibility-toggle"
                    onClick={() =>
                      setShowNewPassword((isVisible) => !isVisible)
                    }
                    title={
                      showNewPassword
                        ? "パスワードを非表示にする"
                        : "パスワードを表示する"
                    }
                    type="button"
                  >
                    {showNewPassword ? (
                      <EyeOff aria-hidden="true" />
                    ) : (
                      <Eye aria-hidden="true" />
                    )}
                  </button>
                </span>
              </label>
              {message || authMessage ? (
                <p className="form-message">{message ?? authMessage}</p>
              ) : null}
              <button className="button button-primary" disabled={submitting}>
                {submitting ? "設定中..." : "利用を開始する"}
              </button>
            </form>
          </>
        ) : (
          <>
            {passwordSetupUnavailable ? (
              <div className="login-copy">
                <p>招待リンクを確認できませんでした</p>
                <h2>ログイン</h2>
              </div>
            ) : null}
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
              {message || authMessage ? (
                <p className="form-message">{message ?? authMessage}</p>
              ) : null}
              {!message && !authMessage && passwordSetupUnavailable ? (
                <p className="form-message">
                  招待メールのリンクをもう一度開いてください。
                </p>
              ) : null}
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
