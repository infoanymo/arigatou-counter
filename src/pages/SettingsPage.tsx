import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  CalendarDays,
  ImagePlus,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { ProfileAvatar } from "../components/ProfileAvatar";
import { isValidAvatarFile, maxAvatarBytes, readAvatarFile } from "../lib/avatar";
import { useAuth } from "../lib/auth";
import type { Period } from "../lib/database.types";
import { formatNumber } from "../lib/format";
import { getSupabase } from "../lib/supabase";

type SettingsSection = "profile" | "period";

type PeriodForm = {
  id: string | null;
  name: string;
  starts_on: string;
  ends_on: string;
  target_count: string;
};

const today = new Date().toISOString().slice(0, 10);

function parseIntegerInput(value: string) {
  return Number(value.replace(/,/g, ""));
}

function formatIntegerInput(value: string) {
  const digits = value.trim().replace(/\D/g, "");
  if (!digits) return "";
  return formatNumber(Number(digits));
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

async function invokeProfile<T>(body: Record<string, unknown>): Promise<T> {
  const client = getSupabase();
  const { data, error } = await client.functions.invoke<T>("profile-settings", {
    body,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as T;
}

export function SettingsPage({ section }: { section: SettingsSection }) {
  const { user, profile, isAdmin, refreshAuth } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarScale, setAvatarScale] = useState(100);
  const [periodForm, setPeriodForm] = useState<PeriodForm>(defaultPeriodForm);
  const [saving, setSaving] = useState(false);
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadPeriod = useCallback(async () => {
    if (!isAdmin || section !== "period") return;
    const client = getSupabase();
    setMessage(null);

    const { data, error } = await client
      .from("periods")
      .select("*")
      .eq("is_active", true)
      .order("starts_on", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      setMessage("期設定を読み込めませんでした。");
      return;
    }

    setPeriodForm(formFromPeriod(data));
  }, [isAdmin, section]);

  useEffect(() => {
    setDisplayName(profile?.display_name ?? "");
    setCompanyName(profile?.company_name ?? "");
    setAvatarUrl(profile?.avatar_url ?? null);
    setAvatarScale(profile?.avatar_scale ?? 100);
  }, [profile]);

  useEffect(() => {
    void loadPeriod();
  }, [loadPeriod]);

  async function handleIconChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!isValidAvatarFile(file)) {
      setMessage(`アイコンは画像ファイル、${Math.floor(maxAvatarBytes / 1000)}KB以下にしてください。`);
      return;
    }

    try {
      setAvatarUrl(await readAvatarFile(file));
      setMessage(null);
    } catch {
      setMessage("アイコン画像を読み込めませんでした。");
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!displayName.trim()) {
      setMessage("登録名を入力してください。");
      return;
    }

    if (!companyName.trim()) {
      setMessage("会社名を入力してください。");
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      await invokeProfile({
        action: "update",
        displayName: displayName.trim(),
        companyName: companyName.trim(),
        avatarUrl,
        avatarScale,
      });
      await refreshAuth();
      setMessage("プロフィールを保存しました。");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "プロフィールを保存できませんでした。",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handlePeriodSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getSupabase();
    const target = parseIntegerInput(periodForm.target_count);

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
      await loadPeriod();
    }

    setSavingPeriod(false);
  }

  const isProfileSection = section === "profile";
  const profileIncomplete = !profile?.display_name?.trim() || !profile.company_name?.trim();

  return (
    <div className="settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>{isProfileSection ? "プロフィール設定" : "目標設定"}</h1>
          <p>
            {isProfileSection
              ? "登録名と会社名を設定してください。"
              : "今期の名前、期間、目標数を設定します。"}
          </p>
        </div>
      </header>

      {message ? <p className="notice">{message}</p> : null}
      {!message && isProfileSection && profileIncomplete ? (
        <p className="notice">
          初回ログイン時は、登録名と会社名の設定が必要です。
        </p>
      ) : null}

      {isProfileSection ? (
        <section className="panel settings-panel">
        <div className="panel-title">
          <UserRound aria-hidden="true" />
          <div>
            <p className="eyebrow">Profile</p>
            <h2>表示プロフィール</h2>
          </div>
        </div>

        <form className="form-stack" onSubmit={handleSubmit}>
          <div className="avatar-picker profile-avatar-picker">
            <ProfileAvatar
              name={displayName || user?.email || "ユーザー"}
              src={avatarUrl}
              avatarScale={avatarScale}
              size="lg"
            />
            <label className="avatar-upload">
              <span>アイコン</span>
              <input accept="image/*" onChange={handleIconChange} type="file" />
            </label>
            {avatarUrl ? (
              <button
                className="button button-secondary"
                onClick={() => setAvatarUrl(null)}
                type="button"
              >
                削除
              </button>
            ) : null}
          </div>

          <label>
            <span>アイコンサイズ</span>
            <div className="range-field">
              <input
                aria-label="アイコンサイズ"
                max={180}
                min={80}
                onChange={(event) => setAvatarScale(Number(event.target.value))}
                step={5}
                type="range"
                value={avatarScale}
              />
              <strong>{avatarScale}%</strong>
            </div>
          </label>

          <label>
            <span>登録名</span>
            <div className="input-shell">
              <UserRound aria-hidden="true" />
              <input
                onChange={(event) => setDisplayName(event.target.value)}
                required
                value={displayName}
              />
            </div>
          </label>

          <label>
            <span>会社名</span>
            <div className="input-shell">
              <Building2 aria-hidden="true" />
              <input
                onChange={(event) => setCompanyName(event.target.value)}
                required
                value={companyName}
              />
            </div>
          </label>

          <button className="button button-primary" disabled={saving}>
            {saving ? <ImagePlus aria-hidden="true" /> : <Save aria-hidden="true" />}
            {saving ? "保存中..." : "プロフィールを保存"}
          </button>
        </form>
      </section>
      ) : (
        <section className="panel settings-panel">
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
                onBlur={() =>
                  setPeriodForm((current) => ({
                    ...current,
                    target_count: formatIntegerInput(current.target_count),
                  }))
                }
                required
                type="text"
                value={periodForm.target_count}
              />
            </label>
            <button className="button button-primary" disabled={savingPeriod}>
              <ShieldCheck aria-hidden="true" />
              {savingPeriod ? "保存中..." : "期設定を保存"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
