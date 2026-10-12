type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
  count: number | null;
};

export async function loadAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  maxRows = Infinity,
): Promise<T[]> {
  if (maxRows <= 0) return [];
  const rows: T[] = [];
  let total: number | null = null;
  do {
    const result = await fetchPage(
      rows.length,
      Math.min(rows.length + 499, maxRows - 1),
    );
    if (result.error) throw new Error(result.error.message);
    if (total === null) {
      if (result.count === null)
        throw new Error("対象の件数を取得できませんでした。");
      total = Math.min(result.count, maxRows);
    }
    const page = result.data ?? [];
    if (!page.length && rows.length < total) {
      throw new Error("データが変更されました。更新してください。");
    }
    rows.push(...page);
  } while (rows.length < total);
  return rows;
}

export async function loadRowsForIds<T>(
  ids: string[],
  fetchPage: (
    batch: string[],
    from: number,
    to: number,
  ) => PromiseLike<PageResult<T>>,
) {
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    rows.push(...(await loadAllRows((from, to) => fetchPage(batch, from, to))));
  }
  return rows;
}
