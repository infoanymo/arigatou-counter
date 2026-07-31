import { UserRound } from "lucide-react";

type ProfileAvatarProps = {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  avatarScale?: number | null;
};

function avatarInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function normalizeScale(value?: number | null) {
  if (!value || !Number.isFinite(value)) return 1;
  return Math.min(1.8, Math.max(0.8, value / 100));
}

export function ProfileAvatar({
  name,
  src,
  size = "md",
  avatarScale,
}: ProfileAvatarProps) {
  const className = `avatar avatar-${size}`;

  if (src) {
    return (
      <span className={className} aria-hidden="true">
        <img
          className="avatar-image"
          src={src}
          alt=""
          style={{ "--avatar-scale": normalizeScale(avatarScale) } as React.CSSProperties}
        />
      </span>
    );
  }

  return (
    <span className={`${className} avatar-fallback`} aria-hidden="true">
      {name.trim() ? avatarInitial(name) : <UserRound aria-hidden="true" />}
    </span>
  );
}
