import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { BarChart3, HeartHandshake, LogOut, Settings, SlidersHorizontal } from "lucide-react";
import { AdminPage } from "./pages/AdminPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useAuth } from "./lib/auth";
import { isSupabaseConfigured } from "./lib/supabase";
import { ProfileAvatar } from "./components/ProfileAvatar";

function LoadingScreen() {
  return (
    <main className="center-screen">
      <div className="loader-panel">
        <div className="pulse-mark" />
        <p>ありがとうを読み込んでいます</p>
      </div>
    </main>
  );
}

function SetupRequired() {
  return (
    <main className="center-screen setup-screen">
      <section className="setup-panel">
        <div className="brand-lockup">
          <span className="brand-mark">
            <HeartHandshake aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">初期設定</p>
            <h1>Supabaseの接続情報が必要です</h1>
          </div>
        </div>
        <p>
          `.env.local` に `VITE_SUPABASE_URL` と
          `VITE_SUPABASE_PUBLISHABLE_KEY` を設定すると、ログインとリアルタイム集計が使えます。
        </p>
      </section>
    </main>
  );
}

function DisabledAccount() {
  const { signOut, authMessage } = useAuth();

  return (
    <main className="center-screen">
      <section className="setup-panel">
        <p className="eyebrow">アカウント停止中</p>
        <h1>このアカウントでは利用できません</h1>
        <p>{authMessage ?? "管理者に確認してください。"}</p>
        <button className="button button-secondary" onClick={() => void signOut()}>
          <LogOut aria-hidden="true" />
          ログアウト
        </button>
      </section>
    </main>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { user, profile, isAdmin, signOut } = useAuth();
  const displayName = profile?.display_name || user?.email || "メンバー";
  const roleLabel = isAdmin ? "管理者" : "メンバー";

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="メインナビゲーション">
        <div className="brand-lockup compact">
          <span className="brand-mark">
            <HeartHandshake aria-hidden="true" />
          </span>
          <div>
            <strong>オキアリ</strong>
            <span>今期の声を集める場所</span>
          </div>
        </div>
        <nav className="nav-list">
          <NavLink to="/" end>
            <BarChart3 aria-hidden="true" />
            ダッシュボード
          </NavLink>
          <NavLink to="/settings">
            <SlidersHorizontal aria-hidden="true" />
            設定
          </NavLink>
          {isAdmin ? (
            <NavLink to="/admin">
              <Settings aria-hidden="true" />
              管理
            </NavLink>
          ) : null}
        </nav>
        <div className="account-card">
          <ProfileAvatar
            name={displayName}
            src={profile?.avatar_url}
            avatarScale={profile?.avatar_scale}
            size="sm"
          />
          <div>
            <strong>{displayName}</strong>
            <span>
              {profile?.company_name ? `${profile.company_name} / ` : ""}
              {roleLabel}
            </span>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="ログアウト"
            title="ログアウト"
            onClick={() => void signOut()}
          >
            <LogOut aria-hidden="true" />
          </button>
        </div>
      </aside>
      <main className="main-surface">{children}</main>
    </div>
  );
}

function RequireAuth({
  children,
  adminOnly = false,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
}) {
  const { user, profile, loading, isAdmin } = useAuth();

  if (!isSupabaseConfigured) return <SetupRequired />;
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.status === "disabled") return <DisabledAccount />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;

  return <AppShell>{children}</AppShell>;
}

function FallbackRoute() {
  const href = window.location.href;
  if (
    href.includes("type=invite") ||
    href.includes("type=recovery") ||
    href.includes("mode=set-password")
  ) {
    return <Navigate to="/login?mode=set-password" replace />;
  }

  return <Navigate to="/" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/admin"
        element={
          <RequireAuth adminOnly>
            <AdminPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<FallbackRoute />} />
    </Routes>
  );
}
