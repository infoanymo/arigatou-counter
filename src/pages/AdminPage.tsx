import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Calculator,
  CreditCard,
  ExternalLink,
  KeyRound,
  RefreshCcw,
  Trash2,
  TriangleAlert,
  UserRound,
  UserCog,
} from "lucide-react";
import type {
  Period,
  Profile,
  ProfileStatus,
  ThankYouAdjustment,
} from "../lib/database.types";
import { formatDateTime, formatNumber } from "../lib/format";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { ProfileAvatar } from "../components/ProfileAvatar";

type AdminUser = {
  id: string;
  email: string;
  displayName: string | null;
  companyName: string | null;
  avatarUrl: string | null;
  avatarScale: number;
  role: "admin" | "member";
  status: ProfileStatus;
  createdAt: string;
  lastSignInAt: string | null;
};

type PeriodForm = {
  id: string | null;
  name: string;
  starts_on: string;
  ends_on: string;
  target_count: string;
};

type AdjustmentWithProfile = ThankYouAdjustment & {
  profiles: Pick<Profile, "display_name" | "email" | "avatar_url" | "avatar_scale"> | null;
};

type AdminSection = "account" | "adjustment" | "billing";

type BillingPrice = {
  amount?: number;
  description?: string;
  interval?: string;
  type?: string;
};

type BillingAddon = {
  type: string;
  variantId: string;
  name: string;
  price: BillingPrice | null;
  estimatedMonthlyUsd: number;
};

type BillingUsage = {
  live: boolean;
  generatedAt: string;
  message?: string;
  missing?: string[];
  project?: {
    ref: string;
    name: string;
    region: string;
    status: string;
    organizationSlug: string;
  };
  organization?: {
    name: string;
    slug: string;
    plan: "free" | "pro" | "team" | "enterprise" | "platform";
  } | null;
  billingPageUrl?: string;
  usagePageUrl?: string;
  selectedAddons?: BillingAddon[];
  selectedAddonEstimatedMonthlyUsd?: number;
  apiRequestCount?: number | null;
  apiCounts?: {
    timestamp: string;
    total_auth_requests: number;
    total_realtime_requests: number;
    total_rest_requests: number;
    total_storage_requests: number;
  }[];
  warnings?: string[];
};

const planLabels = {
  free: "Free",
  pro: "Pro",
  team: "Team",
  enterprise: "Enterprise",
  platform: "Platform",
} as const;

const planBaseMonthlyUsd: Record<keyof typeof planLabels, number | null> = {
  free: 0,
  pro: 25,
  team: 599,
  enterprise: null,
  platform: null,
};

const usdToJpyRate = 158;
const today = new Date().toISOString().slice(0, 10);

function parseIntegerInput(value: string) {
  return Number(value.replace(/,/g, ""));
}

function formatIntegerInput(value: string, signed = false) {
  const trimmed = value.trim();
  const sign = signed && /^[+-]/.test(trimmed) ? trimmed[0] : "";
  const digits = trimmed.replace(/\D/g, "");

  if (!digits) return sign;
  return `${sign}${formatNumber(Number(digits))}`;
}

function formatYenFromUsd(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "個別見積";
  return new Intl.NumberFormat("ja-JP", {
    currency: "JPY",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(Math.round(value * usdToJpyRate));
}

function formatBillingDate(value: string | null | undefined) {
  if (!value) return "未取得";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function billingPlanCost(usage: BillingUsage | null) {
  if (!usage?.organization?.plan) return null;
  return planBaseMonthlyUsd[usage.organization.plan] ?? null;
}

function billingApiBreakdown(usage: BillingUsage | null) {
  const latest = usage?.apiCounts?.at(-1);
  if (!latest) {
    return {
      auth: 0,
      realtime: 0,
      rest: 0,
      storage: 0,
    };
  }

  return {
    auth: latest.total_auth_requests,
    realtime: latest.total_realtime_requests,
    rest: latest.total_rest_requests,
    storage: latest.total_storage_requests,
  };
}

function defaultPeriodForm(): PeriodForm {
  const end = new Date();
  end.setMonth(end.getMonth() + 3);

  return {
    id: null,
    name: "今期",
    starts_on: today,
    ends_on: end.toISOString().slice(0, 10),
    target_count: formatNumber(1000),
  };
}

function formFromPeriod(period: Period | null): PeriodForm {
  if (!period) return defaultPeriodForm();
  return {
    id: period.id,
    name: period.name,
    starts_on: period.starts_on,
    ends_on: period.ends_on,
    target_count: formatNumber(period.target_count),
  };
}

async function invokeAdmin<T>(
  body: Record<string, unknown>,
): Promise<T> {
  const client = getSupabase();
  const { data, error } = await client.functions.invoke<T>("admin-users", {
    body,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as T;
}

async function invokeBilling(): Promise<BillingUsage> {
  const client = getSupabase();
  const { data, error } = await client.functions.invoke<BillingUsage>(
    "billing-usage",
    {
      body: { action: "summary" },
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  return data as BillingUsage;
}

export function AdminPage({ section }: { section: AdminSection }) {
  const { user, refreshAuth } = useAuth();
  const [periodForm, setPeriodForm] = useState<PeriodForm>(defaultPeriodForm);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentWithProfile[]>([]);
  const [eventCount, setEventCount] = useState(0);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountRole, setAccountRole] = useState<"member" | "admin">("member");
  const [adjustmentDelta, setAdjustmentDelta] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [clearingThankYous, setClearingThankYous] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [billingUsage, setBillingUsage] = useState<BillingUsage | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);

  const adjustmentTotal = useMemo(
    () => adjustments.reduce((sum, item) => sum + item.delta, 0),
    [adjustments],
  );
  const adjustedTotal = Math.max(0, eventCount + adjustmentTotal);

  const sortedUsers = useMemo(
    () =>
      [...users].sort((a, b) => {
        if (a.status !== b.status) return a.status === "active" ? -1 : 1;
        if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
        return a.email.localeCompare(b.email);
      }),
    [users],
  );

  const loadAdjustmentSummary = useCallback(async (periodId: string) => {
    const client = getSupabase();

    const { count, error: countError } = await client
      .from("thank_you_events")
      .select("*", { count: "exact", head: true })
      .eq("period_id", periodId);

    if (countError) {
      setMessage("ありがとう件数を読み込めませんでした。");
      setEventCount(0);
    } else {
      setEventCount(count ?? 0);
    }

    const { data, error: adjustmentsError } = await client
      .from("thank_you_adjustments")
      .select(
        "id, period_id, admin_user_id, delta, reason, created_at, profiles:profiles!thank_you_adjustments_admin_user_id_fkey(display_name,email,avatar_url,avatar_scale)",
      )
      .eq("period_id", periodId)
      .order("created_at", { ascending: false })
      .limit(30)
      .returns<AdjustmentWithProfile[]>();

    if (adjustmentsError) {
      setMessage("補正履歴を読み込めませんでした。");
      setAdjustments([]);
      return;
    }

    setAdjustments(data ?? []);
  }, []);

  const loadAdmin = useCallback(async () => {
    const client = getSupabase();
    setLoading(true);
    setMessage(null);

    const { data: period, error: periodError } = await client
      .from("periods")
      .select("*")
      .eq("is_active", true)
      .order("starts_on", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (periodError) {
      setMessage("期設定を読み込めませんでした。");
      setAdjustments([]);
      setEventCount(0);
    } else {
      setPeriodForm(formFromPeriod(period));
      if (period) {
        await loadAdjustmentSummary(period.id);
      } else {
        setAdjustments([]);
        setEventCount(0);
      }
    }

    try {
      const response = await invokeAdmin<{ users: AdminUser[] }>({
        action: "list",
      });
      setUsers(response.users);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ユーザー一覧を読み込めませんでした。",
      );
    } finally {
      setLoading(false);
    }
  }, [loadAdjustmentSummary]);

  const loadBilling = useCallback(async () => {
    setBillingLoading(true);
    try {
      setBillingUsage(await invokeBilling());
    } catch (error) {
      setBillingUsage({
        live: false,
        generatedAt: new Date().toISOString(),
        message:
          error instanceof Error
            ? error.message
            : "利用料情報を取得できませんでした。",
      });
    } finally {
      setBillingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (section === "billing") {
      setLoading(false);
      void loadBilling();
      return;
    }

    void loadAdmin();
  }, [loadAdmin, loadBilling, section]);

  async function handleCreateAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingAccount(true);
    setMessage(null);

    try {
      await invokeAdmin({
        action: "create-user",
        email: accountEmail.trim(),
        password: accountPassword,
        role: accountRole,
      });
      setAccountEmail("");
      setAccountPassword("");
      setAccountRole("member");
      setMessage("アカウントを発行しました。");
      await loadAdmin();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "アカウントを発行できませんでした。",
      );
    } finally {
      setCreatingAccount(false);
    }
  }

  async function handleAdjustmentSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!periodForm.id) {
      setMessage("先に期設定を保存してください。");
      return;
    }

    const delta = parseIntegerInput(adjustmentDelta);
    if (!Number.isInteger(delta) || delta === 0) {
      setMessage("補正数は0以外の整数で入力してください。");
      return;
    }

    setSavingAdjustment(true);
    setMessage(null);

    try {
      await invokeAdmin({
        action: "adjust-thank-you",
        periodId: periodForm.id,
        delta,
        reason: adjustmentReason.trim() || null,
      });
      setAdjustmentDelta("");
      setAdjustmentReason("");
      setMessage("ありがとう件数を補正しました。");
      await loadAdjustmentSummary(periodForm.id);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "補正を登録できませんでした。管理者権限を確認してください。",
      );
    }

    setSavingAdjustment(false);
  }

  async function handleClearThankYous() {
    if (!periodForm.id || clearingThankYous) return;

    setClearingThankYous(true);
    setMessage(null);

    try {
      await invokeAdmin({
        action: "clear-thank-yous",
        periodId: periodForm.id,
      });
      setMessage("今期のありがとうをすべて削除しました。");
      setShowClearDialog(false);
      await loadAdmin();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ありがとうを削除できませんでした。",
      );
    } finally {
      setClearingThankYous(false);
    }
  }

  async function updateUser(
    targetUser: AdminUser,
    action: "set-role" | "set-status",
    value: string,
  ) {
    setMessage(null);
    try {
      await invokeAdmin({
        action,
        userId: targetUser.id,
        value,
      });
      setMessage("ユーザー設定を更新しました。");
      await loadAdmin();
      if (targetUser.id === user?.id) await refreshAuth();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "ユーザー設定を更新できませんでした。",
      );
    }
  }

  const sectionTitle =
    section === "account" ? "アカウント" : section === "adjustment" ? "件数調整" : "料金";
  const sectionDescription =
    section === "account"
      ? "アカウント発行とユーザー権限を管理します。"
      : section === "adjustment"
        ? "ありがとう件数の補正と全削除を管理します。"
        : "このアプリの運営にかかる利用料の目安を確認します。";
  const billingBreakdown = billingApiBreakdown(billingUsage);
  const billingBaseCost = billingPlanCost(billingUsage);
  const billingAddonCost = billingUsage?.selectedAddonEstimatedMonthlyUsd ?? null;
  const billingTotalCost =
    typeof billingBaseCost === "number" && typeof billingAddonCost === "number"
      ? billingBaseCost + billingAddonCost
      : null;
  const billingPlanLabel = billingUsage?.organization?.plan
    ? planLabels[billingUsage.organization.plan]
    : "未取得";

  return (
    <div className="admin-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>{sectionTitle}</h1>
          <p>{sectionDescription}</p>
        </div>
        <button
          className="button button-secondary"
          disabled={section === "billing" ? billingLoading : loading}
          onClick={() =>
            section === "billing" ? void loadBilling() : void loadAdmin()
          }
        >
          <RefreshCcw aria-hidden="true" />
          {section === "billing" && billingLoading ? "取得中..." : "更新"}
        </button>
      </header>

      {message ? <p className="notice">{message}</p> : null}

      <nav className="admin-tabs" aria-label="管理メニュー">
        <NavLink to="/admin/account">
          <UserCog aria-hidden="true" />
          アカウント
        </NavLink>
        <NavLink to="/admin/adjustment">
          <Calculator aria-hidden="true" />
          件数調整
        </NavLink>
        <NavLink to="/admin/billing">
          <CreditCard aria-hidden="true" />
          料金
        </NavLink>
      </nav>

      {section === "account" ? (
        <>
          <section className="admin-grid single-column">
            <article className="panel">
              <div className="panel-title">
                <UserRound aria-hidden="true" />
                <div>
                  <p className="eyebrow">Account</p>
                  <h2>アカウント発行</h2>
                </div>
              </div>
              <form className="form-stack" onSubmit={handleCreateAccount}>
                <label>
                  <span>メールアドレス</span>
                  <input
                    autoComplete="email"
                    inputMode="email"
                    onChange={(event) => setAccountEmail(event.target.value)}
                    required
                    type="email"
                    value={accountEmail}
                  />
                </label>
                <label>
                  <span>パスワード</span>
                  <div className="input-shell">
                    <KeyRound aria-hidden="true" />
                    <input
                      autoComplete="new-password"
                      minLength={6}
                      onChange={(event) => setAccountPassword(event.target.value)}
                      required
                      type="password"
                      value={accountPassword}
                    />
                  </div>
                </label>
                <label>
                  <span>権限</span>
                  <select
                    onChange={(event) =>
                      setAccountRole(event.target.value as "member" | "admin")
                    }
                    value={accountRole}
                  >
                    <option value="member">メンバー</option>
                    <option value="admin">管理者</option>
                  </select>
                </label>
                <button className="button button-primary" disabled={creatingAccount}>
                  <UserRound aria-hidden="true" />
                  {creatingAccount ? "発行中..." : "アカウントを発行"}
                </button>
              </form>
            </article>
          </section>

          <section className="panel users-panel">
            <div className="panel-title">
              <UserCog aria-hidden="true" />
              <div>
                <p className="eyebrow">Users</p>
                <h2>ユーザー管理</h2>
              </div>
            </div>
            {loading ? (
              <p className="muted">読み込み中...</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ユーザー</th>
                      <th>権限</th>
                      <th>状態</th>
                      <th>最終ログイン</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedUsers.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className="user-cell">
                            <ProfileAvatar
                              name={item.displayName || item.email}
                              src={item.avatarUrl}
                              avatarScale={item.avatarScale}
                            />
                            <div>
                              <strong>{item.displayName || item.email}</strong>
                              <span>{item.email}</span>
                              {item.companyName ? <span>{item.companyName}</span> : null}
                            </div>
                          </div>
                        </td>
                        <td>
                          <select
                            disabled={item.id === user?.id}
                            onChange={(event) =>
                              void updateUser(item, "set-role", event.target.value)
                            }
                            value={item.role}
                          >
                            <option value="member">メンバー</option>
                            <option value="admin">管理者</option>
                          </select>
                        </td>
                        <td>
                          <select
                            disabled={item.id === user?.id}
                            onChange={(event) =>
                              void updateUser(item, "set-status", event.target.value)
                            }
                            value={item.status}
                          >
                            <option value="active">有効</option>
                            <option value="disabled">停止</option>
                          </select>
                        </td>
                        <td>
                          {item.lastSignInAt
                            ? formatDateTime(item.lastSignInAt)
                            : "未ログイン"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : section === "adjustment" ? (
        <section className="admin-grid single-column">
          <article className="panel">
            <div className="panel-title">
              <Calculator aria-hidden="true" />
              <div>
                <p className="eyebrow">Adjustment</p>
                <h2>ありがとう件数調整</h2>
              </div>
            </div>
          <div className="adjustment-summary" aria-label="ありがとう件数の内訳">
            <div>
              <span>押下数</span>
              <strong>{formatNumber(eventCount)}</strong>
            </div>
            <div>
              <span>補正</span>
              <strong>
                {adjustmentTotal > 0 ? "+" : ""}
                {formatNumber(adjustmentTotal)}
              </strong>
            </div>
            <div>
              <span>表示総数</span>
              <strong>{formatNumber(adjustedTotal)}</strong>
            </div>
          </div>
          <form className="form-stack" onSubmit={handleAdjustmentSave}>
            <label>
              <span>補正数</span>
              <input
                inputMode="numeric"
                onChange={(event) => setAdjustmentDelta(event.target.value)}
                onBlur={() =>
                  setAdjustmentDelta((current) => formatIntegerInput(current, true))
                }
                placeholder="+1,000 / -300"
                required
                type="text"
                value={adjustmentDelta}
              />
            </label>
            <label>
              <span>理由</span>
              <input
                onChange={(event) => setAdjustmentReason(event.target.value)}
                placeholder="入力漏れ分など"
                value={adjustmentReason}
              />
            </label>
            <button
              className="button button-primary"
              disabled={savingAdjustment || !periodForm.id}
            >
              <Calculator aria-hidden="true" />
              {savingAdjustment ? "登録中..." : "補正を登録"}
            </button>
          </form>
          <button
            className="button button-danger full-width-button"
            disabled={clearingThankYous || !periodForm.id}
            onClick={() => setShowClearDialog(true)}
            type="button"
          >
            <Trash2 aria-hidden="true" />
            {clearingThankYous ? "削除中..." : "今期のありがとうを全削除"}
          </button>
          <div className="adjustment-history">
            {adjustments.length ? (
              adjustments.slice(0, 5).map((item) => (
                <div className="adjustment-row" key={item.id}>
                  <strong>
                    {item.delta > 0 ? "+" : ""}
                    {formatNumber(item.delta)}
                  </strong>
                  <div className="adjustment-user">
                    <ProfileAvatar
                      name={
                        item.profiles?.display_name ||
                        item.profiles?.email ||
                        "管理者"
                      }
                      src={item.profiles?.avatar_url}
                      avatarScale={item.profiles?.avatar_scale}
                      size="sm"
                    />
                    <div>
                      <span>
                        {item.profiles?.display_name ||
                          item.profiles?.email ||
                          "管理者"}
                      </span>
                      <p>
                        {formatDateTime(item.created_at)}
                        {item.reason ? ` / ${item.reason}` : ""}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">補正履歴はまだありません。</p>
            )}
          </div>
        </article>
      </section>
      ) : (
        <section className="admin-grid billing-grid">
          <article className="panel billing-panel">
            <div className="panel-title">
              <CreditCard aria-hidden="true" />
              <div>
                <p className="eyebrow">Billing</p>
                <h2>利用料</h2>
              </div>
            </div>
            <div
              className={`billing-status ${billingUsage?.live ? "live" : "offline"}`}
            >
              <span>{billingUsage?.live ? "ライブ取得中" : "Management API未接続"}</span>
              <strong>
                最終取得:{" "}
                {billingLoading ? "取得中..." : formatBillingDate(billingUsage?.generatedAt)}
              </strong>
            </div>
            <div className="billing-hero">
              <div>
                <span>現在のSupabaseプラン</span>
                <strong>{billingPlanLabel}</strong>
                <p>
                  {billingUsage?.organization
                    ? `${billingUsage.organization.name} の契約プランです。`
                    : "Organization情報はまだ取得できていません。"}
                </p>
              </div>
              <div>
                <span>プラン＋選択中アドオン</span>
                <strong>{formatYenFromUsd(billingTotalCost)}</strong>
                <p>
                  APIから取得したドル建て価格を円換算した月額目安です。
                </p>
              </div>
            </div>

            {billingUsage?.message ? (
              <p className="billing-note">
                {billingUsage.message}
                {billingUsage.missing?.length
                  ? ` 必要な設定: ${billingUsage.missing.join(", ")}`
                  : ""}
              </p>
            ) : null}

            <div className="billing-metrics">
              <div>
                <span>プラン基本料</span>
                <strong>{formatYenFromUsd(billingBaseCost)}</strong>
              </div>
              <div>
                <span>選択中アドオン</span>
                <strong>{formatYenFromUsd(billingAddonCost)}</strong>
              </div>
              <div>
                <span>APIリクエスト</span>
                <strong>
                  {typeof billingUsage?.apiRequestCount === "number"
                    ? formatNumber(billingUsage.apiRequestCount)
                    : "未取得"}
                </strong>
              </div>
            </div>

            <div className="billing-list">
              <div className="billing-row">
                <div>
                  <strong>GitHub Pages</strong>
                  <span>Static hosting</span>
                </div>
                <p>静的サイト公開。GitHub Pages側の追加利用料はこのアプリでは発生しません。</p>
                <strong>0円</strong>
              </div>
              <div className="billing-row">
                <div>
                  <strong>API内訳</strong>
                  <span>最新の1日集計</span>
                </div>
                <p>
                  Auth {formatNumber(billingBreakdown.auth)} / REST{" "}
                  {formatNumber(billingBreakdown.rest)} / Realtime{" "}
                  {formatNumber(billingBreakdown.realtime)} / Storage{" "}
                  {formatNumber(billingBreakdown.storage)}
                </p>
                <strong>使用量</strong>
              </div>
              {billingUsage?.selectedAddons?.length ? (
                billingUsage.selectedAddons.map((item) => (
                  <div className="billing-row" key={`${item.type}-${item.variantId}`}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.type}</span>
                    </div>
                    <p>
                      {item.price?.description ?? "Supabase Management API価格情報"}
                      {item.price?.interval ? ` / ${item.price.interval}` : ""}
                    </p>
                    <strong>{formatYenFromUsd(item.estimatedMonthlyUsd)}</strong>
                  </div>
                ))
              ) : (
                <div className="billing-row">
                  <div>
                    <strong>選択中アドオン</strong>
                    <span>Billing add-ons</span>
                  </div>
                  <p>選択中の有料アドオンは取得されていません。</p>
                  <strong>0円</strong>
                </div>
              )}
            </div>
            <div className="billing-actions">
              {billingUsage?.billingPageUrl ? (
                <a
                  className="button button-primary"
                  href={billingUsage.billingPageUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink aria-hidden="true" />
                  Supabase請求画面
                </a>
              ) : null}
              {billingUsage?.usagePageUrl ? (
                <a
                  className="button button-secondary"
                  href={billingUsage.usagePageUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink aria-hidden="true" />
                  使用量画面
                </a>
              ) : null}
            </div>
            {billingUsage?.warnings?.length ? (
              <div className="billing-warning">
                {billingUsage.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
            <p className="billing-note">
              この画面はSupabase Management APIから取得できる利用情報を表示しています。
              金額は1ドル={formatNumber(usdToJpyRate)}円で換算しています。税金、割引、請求締め後の確定金額はSupabaseの請求画面で確認してください。
            </p>
          </article>
        </section>
      )}

      {showClearDialog ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-thank-yous-title"
          >
            <div className="confirm-icon">
              <TriangleAlert aria-hidden="true" />
            </div>
            <div>
              <p className="eyebrow">Delete</p>
              <h2 id="clear-thank-yous-title">今期のありがとうを全削除しますか？</h2>
              <p>
                押下されたありがとう、いいね、コメント、補正履歴をすべて削除します。
                この操作は元に戻せません。
              </p>
            </div>
            <div className="confirm-modal-actions">
              <button
                className="button button-secondary"
                disabled={clearingThankYous}
                onClick={() => setShowClearDialog(false)}
                type="button"
              >
                キャンセル
              </button>
              <button
                className="button button-danger"
                disabled={clearingThankYous}
                onClick={() => void handleClearThankYous()}
                type="button"
              >
                <Trash2 aria-hidden="true" />
                {clearingThankYous ? "削除中..." : "全削除する"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
