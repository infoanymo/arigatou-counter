import { useEffect, useState } from "react";
import { Building2, ImagePlus, Save, UserRound } from "lucide-react";
import { ProfileAvatar } from "../components/ProfileAvatar";
import { isValidAvatarFile, maxAvatarBytes, readAvatarFile } from "../lib/avatar";
import { useAuth } from "../lib/auth";
import { getSupabase } from "../lib/supabase";

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

export function SettingsPage() {
  const { user, profile, refreshAuth } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(profile?.display_name ?? "");
    setCompanyName(profile?.company_name ?? "");
    setAvatarUrl(profile?.avatar_url ?? null);
  }, [profile]);

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
      setMessage("表示名を入力してください。");
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

  return (
    <div className="settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>プロフィール設定</h1>
          <p>{user?.email ?? ""}</p>
        </div>
      </header>

      {message ? <p className="notice">{message}</p> : null}

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
            <span>表示名</span>
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
    </div>
  );
}
