import { UserRound } from "lucide-react";

type ProfileAvatarProps = {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
};

function avatarInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export function ProfileAvatar({ name, src, size = "md" }: ProfileAvatarProps) {
  const className = `avatar avatar-${size}`;

  if (src) {
    return <img className={className} src={src} alt="" aria-hidden="true" />;
  }

  return (
    <span className={`${className} avatar-fallback`} aria-hidden="true">
      {name.trim() ? avatarInitial(name) : <UserRound aria-hidden="true" />}
    </span>
  );
}
