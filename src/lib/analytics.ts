type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
  count: number | null;
};

// A requested limit cannot override the API's row cap. Keep fetching using
// the number actually returned, until the exact count has been reached.
export async function loadAllAnalyticsRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let total: number | null = null;

  do {
    const result = await fetchPage(rows.length, rows.length + 499);
    if (result.error) throw new Error(result.error.message);
    if (total === null) {
      total = result.count;
      if (total === null) throw new Error("集計対象の件数を取得できませんでした。");
    }
    const page = result.data ?? [];
    if (!page.length && rows.length < total) {
      throw new Error("集計データが変更されました。更新してください。");
    }
    rows.push(...page);
  } while (rows.length < total);

  return rows;
}

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
