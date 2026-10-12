import assert from "node:assert/strict";
import { test } from "node:test";
import { analyticsDateRange, japanDateValue } from "../src/lib/analytics.ts";
import { loadAllRows as loadAllAnalyticsRows } from "../src/lib/pagination.ts";

test("includes old rows beyond 1,000 and the previous 20,000 limit", async () => {
  const source = Array.from({ length: 20501 }, (_, id) => ({ id }));
  const calls: number[] = [];
  const rows = await loadAllAnalyticsRows(async (from, to) => {
    calls.push(from);
    return {
      data: source.slice(from, to + 1),
      error: null,
      count: from === 0 ? source.length : null,
    };
  });
  assert.deepEqual(rows, source);
  assert.equal(calls.length, 42);
  assert.equal(rows.at(-1)?.id, 20500);
});

test("continues even when the server cap is lower than the requested page size", async () => {
  const source = Array.from({ length: 1101 }, (_, id) => ({ id }));
  const rows = await loadAllAnalyticsRows(async (from) => ({
    data: source.slice(from, from + 100),
    error: null,
    count: from === 0 ? source.length : null,
  }));
  assert.deepEqual(rows, source);
});

test("handles empty data and an exact page boundary without an out-of-range request", async () => {
  for (const count of [0, 500, 1000]) {
    const source = Array.from({ length: count }, (_, id) => id);
    let calls = 0;
    const rows = await loadAllAnalyticsRows(async (from, to) => {
      calls += 1;
      assert.ok(count === 0 || from < count);
      return { data: source.slice(from, to + 1), error: null, count: from === 0 ? count : null };
    });
    assert.deepEqual(rows, source);
    assert.equal(calls, Math.max(1, Math.ceil(count / 500)));
  }
});

test("rejects a later page failure instead of returning a partial total", async () => {
  await assert.rejects(loadAllAnalyticsRows(async (from) => ({
    data: from === 0 ? [1] : null,
    count: from === 0 ? 2 : null,
    error: from === 0 ? null : { message: "API failed" },
  })), /API failed/);
  await assert.rejects(loadAllAnalyticsRows(async (from) => ({
    data: from === 0 ? [1] : [],
    count: from === 0 ? 2 : null,
    error: null,
  })), /変更されました/);
});

test("includes the whole last day in JST and excludes the next midnight", () => {
  const range = analyticsDateRange("2026-09-01", "2026-09-30");
  assert.equal(range.invalid, false);
  assert.equal(range.start, Date.parse("2026-08-31T15:00:00Z"));
  assert.equal(range.endExclusive, Date.parse("2026-09-30T15:00:00Z"));
  assert.ok(Date.parse("2026-09-30T23:59:59.999999+09:00") < range.endExclusive);
  assert.equal(analyticsDateRange("2026-09-30", "2026-09-30").invalid, false);
  assert.equal(analyticsDateRange("2026-10-01", "2026-09-30").invalid, true);
  assert.equal(analyticsDateRange("", "2026-09-30").invalid, true);
  assert.equal(analyticsDateRange("2026-12-31", "2026-12-31").endExclusive, Date.parse("2027-01-01T00:00:00+09:00"));
});

test("uses today's JST date before 09:00 and at the month boundary", () => {
  assert.equal(japanDateValue(new Date("2026-09-30T15:01:00Z")), "2026-10-01");
  assert.equal(japanDateValue(new Date("2026-10-11T15:01:00Z")), "2026-10-12");
});
