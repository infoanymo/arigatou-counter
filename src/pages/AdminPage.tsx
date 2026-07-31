import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Calculator,
  ImagePlus,
  KeyRound,
  RefreshCcw,
  Trash2,
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
import { isValidAvatarFile, maxAvatarBytes, readAvatarFile } from "../lib/avatar";

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

export function AdminPage() {
  const { user, refreshAuth } = useAuth();
  const [periodForm, setPeriodForm] = useState<PeriodForm>(defaultPeriodForm);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentWithProfile[]>([]);
  const [eventCount, setEventCount] = useState(0);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountCompany, setAccountCompany] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountAvatarUrl, setAccountAvatarUrl] = useState<string | null>(null);
  const [accountRole, setAccountRole] = useState<"member" | "admin">("member");
  const [adjustmentDelta, setAdjustmentDelta] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [clearingThankYous, setClearingThankYous] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  useEffect(() => {
    void loadAdmin();
  }, [loadAdmin]);

  async function handleCreateAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingAccount(true);
    setMessage(null);

    try {
      await invokeAdmin({
        action: "create-user",
        email: accountEmail.trim(),
        password: accountPassword,
        displayName: accountName.trim(),
        companyName: accountCompany.trim(),
        avatarUrl: accountAvatarUrl,
        role: accountRole,
      });
      setAccountEmail("");
      setAccountPassword("");
      setAccountCompany("");
      setAccountName("");
      setAccountAvatarUrl(null);
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

  async function handleIconChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!isValidAvatarFile(file)) {
      setMessage(`アイコンは画像ファイル、${Math.floor(maxAvatarBytes / 1000)}KB以下にしてください。`);
      return;
    }

    try {
      setAccountAvatarUrl(await readAvatarFile(file));
    } catch {
      setMessage("アイコン画像を読み込めませんでした。");
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

    const confirmed = window.confirm(
      "今期のありがとう、いいね、コメント、補正履歴をすべて削除します。元に戻せません。実行しますか？",
    );
    if (!confirmed) return;

    setClearingThankYous(true);
    setMessage(null);

    try {
      await invokeAdmin({
        action: "clear-thank-yous",
        periodId: periodForm.id,
      });
      setMessage("今期のありがとうをすべて削除しました。");
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

  return (
    <div className="admin-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>管理</h1>
          <p>アカウント発行、権限、件数補正、ありがとう削除を管理します。</p>
        </div>
        <button className="button button-secondary" onClick={() => void loadAdmin()}>
          <RefreshCcw aria-hidden="true" />
          更新
        </button>
      </header>

      {message ? <p className="notice">{message}</p> : null}

      <section className="admin-grid">
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
              <span>会社名</span>
              <div className="input-shell">
                <Building2 aria-hidden="true" />
                <input
                  onChange={(event) => setAccountCompany(event.target.value)}
                  placeholder="株式会社オキファーム"
                  value={accountCompany}
                />
              </div>
            </label>
            <label>
              <span>表示名</span>
              <input
                onChange={(event) => setAccountName(event.target.value)}
                placeholder="山田 太郎"
                required
                value={accountName}
              />
            </label>
            <div className="avatar-picker">
              <ProfileAvatar
                name={accountName || accountEmail || "ユーザー"}
                src={accountAvatarUrl}
                size="lg"
              />
              <label className="avatar-upload">
                <span>アイコン</span>
                <input accept="image/*" onChange={handleIconChange} type="file" />
              </label>
              {accountAvatarUrl ? (
                <button
                  className="button button-secondary"
                  onClick={() => setAccountAvatarUrl(null)}
                  type="button"
                >
                  削除
                </button>
              ) : null}
            </div>
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
              <ImagePlus aria-hidden="true" />
              {creatingAccount ? "発行中..." : "アカウントを発行"}
            </button>
          </form>
        </article>

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
            onClick={() => void handleClearThankYous()}
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
                      {item.lastSignInAt ? formatDateTime(item.lastSignInAt) : "未ログイン"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
