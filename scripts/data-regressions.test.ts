import assert from "node:assert/strict";
import { test } from "node:test";
import { formatIntegerInput, parseIntegerInput } from "../src/lib/integer-input.ts";
import { loadAllRows, loadRowsForIds } from "../src/lib/pagination.ts";
import { formatDateTime } from "../src/lib/format.ts";

test("integer inputs preserve signs and reject decimals, exponent notation, malformed commas and overflow", () => {
  for (const value of ["1.5", "-1.5", "1e3", "1,2", "2147483648", "", "text10"]) {
    assert.ok(Number.isNaN(parseIntegerInput(value)), value);
    assert.equal(formatIntegerInput(value, true), value);
  }
  assert.equal(parseIntegerInput("-1,000"), -1000);
  assert.equal(parseIntegerInput("＋１，０００"), 1000);
  assert.equal(formatIntegerInput("-1000"), "-1,000");
  assert.equal(formatIntegerInput("+1000", true), "+1,000");
});

test("history windows preserve the requested count above the API cap", async () => {
  const source = Array.from({ length: 1600 }, (_, id) => ({ id }));
  const rows = await loadAllRows(async (from, to) => ({
    data: source.slice(from, to + 1), error: null, count: from === 0 ? source.length : null,
  }), 1200);
  assert.deepEqual(rows, source.slice(0, 1200));
});

test("interaction queries batch IDs and continue past a thousand reactions", async () => {
  const ids = Array.from({ length: 120 }, (_, id) => String(id));
  const source = ids.flatMap((event_id) => Array.from({ length: 12 }, (_, user_id) => ({ event_id, user_id })));
  const rows = await loadRowsForIds(ids, async (batch, from, to) => {
    assert.ok(batch.length <= 100);
    const filtered = source.filter((row) => batch.includes(row.event_id));
    return { data: filtered.slice(from, to + 1), error: null, count: from === 0 ? filtered.length : null };
  });
  assert.deepEqual(rows, source);
});

test("timestamps always display in Japan time", () => {
  const formatted = formatDateTime("2026-09-30T15:01:00Z");
  assert.match(formatted, /10\/1/);
  assert.match(formatted, /00:01/);
});
