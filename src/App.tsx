import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import {
  BarChart3,
  CalendarDays,
  Calculator,
  ChevronDown,
  CreditCard,
  HeartHandshake,
  LogOut,
  MessageCircle,
  Settings,
  SlidersHorizontal,
  Target,
  UserCog,
  UserRound,
} from "lucide-react";
import { AdminPage } from "./pages/AdminPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useAuth } from "./lib/auth";
import type { Profile } from "./lib/database.types";
import { isSupabaseConfigured } from "./lib/supabase";
import { ProfileAvatar } from "./components/ProfileAvatar";
import okifraSidebarLogo from "./okifra-sidebar-logo.png";

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
  const location = useLocation();
  const displayName = profile?.display_name || user?.email || "メンバー";
  const roleLabel = isAdmin ? "管理者" : "メンバー";

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="メインナビゲーション">
        <div className="brand-lockup compact">
          <span className="brand-mark brand-logo-box">
            <img alt="オキアリ" src={okifraSidebarLogo} />
          </span>
        </div>
        <nav className="nav-list">
          <NavLink to="/" end>
            <BarChart3 aria-hidden="true" />
            ダッシュボード
          </NavLink>
          {isAdmin ? (
            <details
              className="nav-group"
              open={location.pathname.startsWith("/analytics")}
            >
              <summary>
                <BarChart3 aria-hidden="true" />
                分析
                <ChevronDown className="nav-chevron" aria-hidden="true" />
              </summary>
              <div className="nav-sublist">
                <NavLink to="/analytics/period">
                  <CalendarDays aria-hidden="true" />
                  期間
                </NavLink>
                <NavLink to="/analytics/person">
                  <UserRound aria-hidden="true" />
                  人物
                </NavLink>
              </div>
            </details>
          ) : null}
          <details
            className="nav-group"
            open={location.pathname.startsWith("/settings")}
          >
            <summary>
              <SlidersHorizontal aria-hidden="true" />
              設定
              <ChevronDown className="nav-chevron" aria-hidden="true" />
            </summary>
            <div className="nav-sublist">
              <NavLink to="/settings/profile">
                <UserRound aria-hidden="true" />
                プロフィール設定
              </NavLink>
              {isAdmin ? (
                <NavLink to="/settings/period">
                  <Target aria-hidden="true" />
                  目標設定
                </NavLink>
              ) : null}
            </div>
          </details>
          {isAdmin ? (
            <details
              className="nav-group"
              open={location.pathname.startsWith("/admin")}
            >
              <summary>
                <Settings aria-hidden="true" />
                管理
                <ChevronDown className="nav-chevron" aria-hidden="true" />
              </summary>
              <div className="nav-sublist">
                <NavLink to="/admin/account">
                  <UserCog aria-hidden="true" />
                  アカウント
                </NavLink>
                <NavLink to="/admin/adjustment">
                  <Calculator aria-hidden="true" />
                  件数調整
                </NavLink>
                <NavLink to="/admin/chatwork">
                  <MessageCircle aria-hidden="true" />
                  チャットワーク連携
                </NavLink>
                <NavLink to="/admin/billing">
                  <CreditCard aria-hidden="true" />
                  料金
                </NavLink>
              </div>
            </details>
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
  const location = useLocation();
  const passwordSetupCallback = isPasswordSetupCallback();

  if (!isSupabaseConfigured) return <SetupRequired />;
  if (loading) return <LoadingScreen />;
  if (!user) {
    return (
      <Navigate
        to={passwordSetupCallback ? "/login?mode=set-password" : "/login"}
        replace
      />
    );
  }
  if (profile?.status === "disabled") return <DisabledAccount />;
  if (passwordSetupCallback && location.pathname !== "/login") {
    return <Navigate to="/login?mode=set-password" replace />;
  }
  if (!isProfileComplete(profile) && location.pathname !== "/settings/profile") {
    return <Navigate to="/settings/profile" replace />;
  }
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;

  return <AppShell>{children}</AppShell>;
}

function isPasswordSetupCallback() {
  const href = window.location.href;
  return (
    href.includes("mode=set-password") ||
    href.includes("type=invite") ||
    href.includes("type=recovery")
  );
}

function FallbackRoute() {
  const { loading } = useAuth();

  if (isPasswordSetupCallback()) {
    if (loading) return <LoadingScreen />;
    return <Navigate to="/login?mode=set-password" replace />;
  }

  return <Navigate to="/" replace />;
}

function isProfileComplete(profile: Profile | null) {
  return Boolean(profile?.display_name?.trim() && profile.company_name?.trim());
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/analytics"
        element={<Navigate to="/analytics/period" replace />}
      />
      <Route
        path="/analytics/period"
        element={
          <RequireAuth adminOnly>
            <AnalyticsPage section="period" />
          </RequireAuth>
        }
      />
      <Route
        path="/analytics/person"
        element={
          <RequireAuth adminOnly>
            <AnalyticsPage section="person" />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={<Navigate to="/admin/account" replace />}
      />
      <Route
        path="/admin/account"
        element={
          <RequireAuth adminOnly>
            <AdminPage section="account" />
          </RequireAuth>
        }
      />
      <Route
        path="/admin/adjustment"
        element={
          <RequireAuth adminOnly>
            <AdminPage section="adjustment" />
          </RequireAuth>
        }
      />
      <Route
        path="/admin/chatwork"
        element={
          <RequireAuth adminOnly>
            <AdminPage section="chatwork" />
          </RequireAuth>
        }
      />
      <Route
        path="/admin/billing"
        element={
          <RequireAuth adminOnly>
            <AdminPage section="billing" />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={<Navigate to="/settings/profile" replace />}
      />
      <Route
        path="/settings/profile"
        element={
          <RequireAuth>
            <SettingsPage section="profile" />
          </RequireAuth>
        }
      />
      <Route
        path="/settings/period"
        element={
          <RequireAuth adminOnly>
            <SettingsPage section="period" />
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
