export function formatNumber(value: number) {
  return new Intl.NumberFormat("ja-JP").format(value);
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

export function daysUntil(value: string) {
  const today = new Date();
  const end = new Date(`${value}T23:59:59`);
  const diff = end.getTime() - today.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}
