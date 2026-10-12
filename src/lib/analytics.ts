export function japanDateValue(now = new Date()) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function analyticsDateRange(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00+09:00`);
  // The next midnight is exclusive, so PostgreSQL microseconds on the final
  // day are included as well.
  const endExclusive = Date.parse(`${endDate}T00:00:00+09:00`) + 86400000;
  return {
    start,
    endExclusive,
    invalid: !Number.isFinite(start) || !Number.isFinite(endExclusive) || start >= endExclusive,
  };
}
