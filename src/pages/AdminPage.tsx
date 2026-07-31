import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  MailPlus,
  RefreshCcw,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import type { Period, ProfileStatus } from "../lib/database.types";
import { formatDateTime } from "../lib/format";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

type AdminUser = {
  id: string;
  email: string;
  displayName: string | null;
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

const today = new Date().toISOString().slice(0, 10);

function defaultPeriodForm(): PeriodForm {
  const end = new Date();
  end.setMonth(end.getMonth() + 3);

  return {
    id: null,
    name: "今期",
    starts_on: today,
    ends_on: end.toISOString().slice(0, 10),
    target_count: "1000",
  };
}

function formFromPeriod(period: Period | null): PeriodForm {
  if (!period) return defaultPeriodForm();
  return {
    id: period.id,
    name: period.name,
    starts_on: period.starts_on,
    ends_on: period.ends_on,
    target_count: String(period.target_count),
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
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [loading, setLoading] = useState(true);
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sortedUsers = useMemo(
    () =>
      [...users].sort((a, b) => {
        if (a.status !== b.status) return a.status === "active" ? -1 : 1;
        if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
        return a.email.localeCompare(b.email);
      }),
    [users],
  );

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
    } else {
      setPeriodForm(formFromPeriod(period));
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
  }, []);

  useEffect(() => {
    void loadAdmin();
  }, [loadAdmin]);

  async function handlePeriodSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getSupabase();
    const target = Number(periodForm.target_count);

    if (!Number.isInteger(target) || target <= 0) {
      setMessage("目標数は1以上の整数で入力してください。");
      return;
    }

    setSavingPeriod(true);
    setMessage(null);

    const payload = {
      name: periodForm.name.trim() || "今期",
      starts_on: periodForm.starts_on,
      ends_on: periodForm.ends_on,
      target_count: target,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const result = periodForm.id
      ? await client.from("periods").update(payload).eq("id", periodForm.id)
      : await client.from("periods").insert(payload).select("*").single();

    if (result.error) {
      setMessage("期設定を保存できませんでした。");
    } else {
      setMessage("期設定を保存しました。");
      await loadAdmin();
    }

    setSavingPeriod(false);
  }

  async function handleInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviting(true);
    setMessage(null);

    try {
      await invokeAdmin({
        action: "invite",
        email: inviteEmail.trim(),
        displayName: inviteName.trim(),
        role: inviteRole,
      });
      setInviteEmail("");
      setInviteName("");
      setInviteRole("member");
      setMessage("招待メールを送信しました。");
      await loadAdmin();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "招待メールを送信できませんでした。",
      );
    } finally {
      setInviting(false);
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
          <p>期の目標、招待、権限を管理します。</p>
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
            <CalendarDays aria-hidden="true" />
            <div>
              <p className="eyebrow">Period</p>
              <h2>今期目標</h2>
            </div>
          </div>
          <form className="form-stack" onSubmit={handlePeriodSave}>
            <label>
              <span>期の名前</span>
              <input
                onChange={(event) =>
                  setPeriodForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                required
                value={periodForm.name}
              />
            </label>
            <div className="form-grid">
              <label>
                <span>開始日</span>
                <input
                  onChange={(event) =>
                    setPeriodForm((current) => ({
                      ...current,
                      starts_on: event.target.value,
                    }))
                  }
                  required
                  type="date"
                  value={periodForm.starts_on}
                />
              </label>
              <label>
                <span>終了日</span>
                <input
                  onChange={(event) =>
                    setPeriodForm((current) => ({
                      ...current,
                      ends_on: event.target.value,
                    }))
                  }
                  required
                  type="date"
                  value={periodForm.ends_on}
                />
              </label>
            </div>
            <label>
              <span>目標数</span>
              <input
                inputMode="numeric"
                min={1}
                onChange={(event) =>
                  setPeriodForm((current) => ({
                    ...current,
                    target_count: event.target.value,
                  }))
                }
                required
                type="number"
                value={periodForm.target_count}
              />
            </label>
            <button className="button button-primary" disabled={savingPeriod}>
              <ShieldCheck aria-hidden="true" />
              {savingPeriod ? "保存中..." : "期設定を保存"}
            </button>
          </form>
        </article>

        <article className="panel">
          <div className="panel-title">
            <MailPlus aria-hidden="true" />
            <div>
              <p className="eyebrow">Invite</p>
              <h2>ユーザー招待</h2>
            </div>
          </div>
          <form className="form-stack" onSubmit={handleInvite}>
            <label>
              <span>メールアドレス</span>
              <input
                autoComplete="email"
                inputMode="email"
                onChange={(event) => setInviteEmail(event.target.value)}
                required
                type="email"
                value={inviteEmail}
              />
            </label>
            <label>
              <span>表示名</span>
              <input
                onChange={(event) => setInviteName(event.target.value)}
                placeholder="山田 太郎"
                value={inviteName}
              />
            </label>
            <label>
              <span>権限</span>
              <select
                onChange={(event) =>
                  setInviteRole(event.target.value as "member" | "admin")
                }
                value={inviteRole}
              >
                <option value="member">メンバー</option>
                <option value="admin">管理者</option>
              </select>
            </label>
            <button className="button button-primary" disabled={inviting}>
              <MailPlus aria-hidden="true" />
              {inviting ? "送信中..." : "招待メールを送る"}
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
                      <strong>{item.displayName || item.email}</strong>
                      <span>{item.email}</span>
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
