import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Install jsdom and esbuild in a temporary directory; point QA_DEPENDENCIES
// at its node_modules. No production account or network is used by these tests.
const qaRequire = createRequire(
  resolve(
    process.env.QA_DEPENDENCIES ?? "/private/tmp/okiari-qa/node_modules",
    "../package.json",
  ),
);
const { JSDOM } = qaRequire("jsdom");
const esbuild = qaRequire("esbuild");
const repoRequire = createRequire(resolve("package.json"));
const React = repoRequire("react");
const { act } = React;
let pages, createRoot, MemoryRouter, dom, bundleDir;

before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://test.invalid/",
  });
  for (const name of [
    "window",
    "document",
    "HTMLElement",
    "HTMLInputElement",
    "MouseEvent",
    "Event",
    "Node",
  ]) {
    globalThis[name] = dom.window[name];
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  bundleDir = await mkdtemp(resolve(tmpdir(), "okiari-ui-"));
  await esbuild.build({
    stdin: {
      contents: `export {SettingsPage} from './src/pages/SettingsPage'; export {DashboardPage} from './src/pages/DashboardPage'; export {AdminPage} from './src/pages/AdminPage'; export {MemoryRouter} from 'react-router-dom';`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    outfile: resolve(bundleDir, "pages.mjs"),
    loader: { ".jpg": "dataurl", ".png": "dataurl" },
    banner: {
      js: "import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);",
    },
    plugins: [
      {
        name: "offline-fixtures",
        setup(build) {
          build.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
            path: repoRequire.resolve(args.path),
            external: true,
          }));
          build.onResolve({ filter: /\/lib\/(?:supabase|auth)$/ }, (args) => ({
            path: args.path,
            namespace: "fixture",
          }));
          build.onResolve({ filter: /^canvas-confetti$/ }, () => ({
            path: "confetti",
            namespace: "fixture",
          }));
          build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents:
              args.path === "confetti"
                ? "export default function(){}"
                : args.path.endsWith("/auth")
                  ? "export function useAuth(){return globalThis.__okiariMock.auth}"
                  : "export function getSupabase(){return globalThis.__okiariMock.client}",
            loader: "js",
          }));
        },
      },
    ],
  });
  pages = await import(pathToFileURL(resolve(bundleDir, "pages.mjs")));
  MemoryRouter = pages.MemoryRouter;
  ({ createRoot } = await import(
    pathToFileURL(repoRequire.resolve("react-dom/client"))
  ));
});

after(async () => {
  dom.window.close();
  await rm(bundleDir, { recursive: true, force: true });
});

const profile = {
  id: "me",
  display_name: "Test Member",
  email: "member@example.invalid",
  company_name: "Test Company",
  avatar_url: null,
  avatar_scale: 100,
  status: "active",
};
const period = {
  id: "period",
  name: "今期",
  starts_on: "2026-10-01",
  ends_on: "2027-03-31",
  target_count: 50000,
  is_active: true,
};
function fixture(tables = {}) {
  const state = {
    tables: {
      periods: [{ ...period }],
      profiles: [profile],
      thank_you_events: [],
      thank_you_adjustments: [],
      thank_you_likes: [],
      thank_you_comments: [],
      chatwork_good_voices: [],
      chatwork_good_voice_likes: [],
      ...tables,
    },
    writes: [],
    channels: [],
    failPeriodSave: false,
  };
  const client = {
    from(table) {
      let filters = [],
        sorts = [],
        from = 0,
        to = Infinity,
        count = false,
        head = false,
        operation = "select",
        payload,
        single = false;
      const query = {
        select(_columns, options = {}) {
          count = options.count === "exact";
          head = options.head === true;
          return query;
        },
        eq(key, value) {
          filters.push((row) => row[key] === value);
          return query;
        },
        in(key, values) {
          filters.push((row) => values.includes(row[key]));
          return query;
        },
        lte(key, value) {
          filters.push((row) => row[key] <= value);
          return query;
        },
        gte(key, value) {
          filters.push((row) => row[key] >= value);
          return query;
        },
        order(key, options = {}) {
          sorts.push([key, options.ascending !== false]);
          return query;
        },
        range(a, b) {
          from = a;
          to = b;
          return query;
        },
        limit(n) {
          to = n - 1;
          return query;
        },
        returns() {
          return query;
        },
        maybeSingle() {
          single = true;
          return query;
        },
        single() {
          single = true;
          return query;
        },
        update(value) {
          operation = "update";
          payload = value;
          return query;
        },
        insert(value) {
          operation = "insert";
          payload = value;
          return query;
        },
        then(success, failure) {
          return Promise.resolve()
            .then(() => {
              let rows = (state.tables[table] ?? []).filter((row) =>
                filters.every((filter) => filter(row)),
              );
              if (operation !== "select") {
                state.writes.push({ table, operation, payload });
                if (table === "periods" && state.failPeriodSave)
                  return {
                    data: null,
                    error: { message: "save failed" },
                    count: null,
                  };
                if (operation === "update")
                  rows.forEach((row) => Object.assign(row, payload));
                else {
                  const row = { id: "new", ...payload };
                  state.tables[table].push(row);
                  rows = [row];
                }
              }
              rows = [...rows].sort((a, b) => {
                for (const [key, ascending] of sorts) {
                  const n = String(a[key]).localeCompare(String(b[key]));
                  if (n) return ascending ? n : -n;
                }
                return 0;
              });
              const total = rows.length;
              rows = rows.slice(from, Math.min(to + 1, from + 1000));
              return {
                data: head ? null : single ? (rows[0] ?? null) : rows,
                error: null,
                count: count ? total : null,
              };
            })
            .then(success, failure);
        },
      };
      return query;
    },
    functions: { invoke: async () => ({ data: { users: [] }, error: null }) },
    channel(name) {
      const channel = {
        name,
        callbacks: [],
        on(_event, filter, callback) {
          channel.callbacks.push({ filter, callback });
          return channel;
        },
        subscribe(callback) {
          callback?.("SUBSCRIBED");
          state.channels.push(channel);
          return channel;
        },
      };
      return channel;
    },
    removeChannel(channel) {
      state.channels = state.channels.filter((item) => item !== channel);
      return Promise.resolve();
    },
  };
  state.client = client;
  state.auth = {
    user: { id: "me", email: profile.email },
    profile,
    isAdmin: true,
    refreshAuth: async () => {},
  };
  globalThis.__okiariMock = state;
  return state;
}
async function flush() {
  for (let i = 0; i < 8; i++)
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
}
async function mount(Component, props) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      React.createElement(
        MemoryRouter,
        {},
        React.createElement(Component, props),
      ),
    ),
  );
  await flush();
  return {
    container,
    async close() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
async function change(input, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function blur(input) {
  await act(async () =>
    input.dispatchEvent(
      new dom.window.FocusEvent("focusout", { bubbles: true }),
    ),
  );
}
async function click(button) {
  await act(async () =>
    button.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  await flush();
}
function button(container, text) {
  return [...container.querySelectorAll("button")].find((node) =>
    node.textContent.trim().includes(text),
  );
}

for (const value of ["-1", "1.5", "1e3"])
  test(`target input ${value} is rejected without changing its meaning`, async () => {
    const state = fixture();
    const view = await mount(pages.SettingsPage, { section: "period" });
    const input = [...view.container.querySelectorAll("input")].at(-1);
    await change(input, value);
    await blur(input);
    assert.equal(input.value, value);
    await click(button(view.container, "期設定を保存"));
    assert.match(view.container.textContent, /目標数は1以上の整数/);
    assert.equal(state.writes.length, 0);
    await view.close();
  });

test("period save retains the success message and recovers after failure", async () => {
  const state = fixture();
  const view = await mount(pages.SettingsPage, { section: "period" });
  state.failPeriodSave = true;
  await click(button(view.container, "期設定を保存"));
  assert.match(view.container.textContent, /保存できませんでした/);
  assert.equal(button(view.container, "期設定を保存").disabled, false);
  state.failPeriodSave = false;
  await click(button(view.container, "期設定を保存"));
  assert.match(view.container.textContent, /期設定を保存しました/);
  await view.close();
});

test("admin totals include more than 30 adjustments and omit community posts from deletion list", async () => {
  fixture({
    thank_you_adjustments: Array.from({ length: 35 }, (_, id) => ({
      id: String(id),
      period_id: "period",
      delta: 10,
      created_at: "2026-10-01T00:00:00Z",
      profiles: profile,
    })),
    thank_you_events: [
      {
        id: "post",
        kind: "community_post",
        period_id: "period",
        created_at: "2026-10-01T00:00:00Z",
        user_id: "me",
        profiles: profile,
      },
    ],
  });
  const view = await mount(pages.AdminPage, { section: "adjustment" });
  assert.equal(
    view.container.querySelector('[aria-label="ありがとう件数の内訳"]')
      .textContent,
    "押下数0補正+350表示総数350",
  );
  assert.equal(
    view.container.querySelectorAll(".thank-you-delete-row").length,
    0,
  );
  await view.close();
});

test("loaded older history has interactions and remains expanded after a realtime update", async () => {
  const events = Array.from({ length: 45 }, (_, i) => ({
    id: `event-${i}`,
    period_id: "period",
    kind: "thank_you",
    user_id: "me",
    created_at: new Date(Date.UTC(2026, 9, 12, 0, 0, 45 - i)).toISOString(),
    profiles: profile,
  }));
  const state = fixture({
    thank_you_events: events,
    thank_you_likes: [
      {
        event_id: "event-25",
        user_id: "me",
        reaction: "like",
        profiles: profile,
      },
    ],
    thank_you_comments: [
      {
        id: "comment",
        event_id: "event-25",
        user_id: "me",
        body: "older comment",
        created_at: "2026-10-12T00:00:00Z",
        profiles: profile,
      },
    ],
  });
  const view = await mount(pages.DashboardPage, {});
  assert.equal(
    view.container.querySelectorAll(".timeline-row:not(.empty)").length,
    20,
  );
  await click(button(view.container, "過去のありがとうを読み込む"));
  assert.equal(
    view.container.querySelectorAll(".timeline-row:not(.empty)").length,
    40,
  );
  assert.match(view.container.textContent, /older comment/);
  assert.equal(
    view.container.querySelectorAll('[aria-label="いいねを押した人を見る"]')
      .length,
    1,
  );
  await act(async () => {
    for (const channel of [...state.channels])
      for (const { filter, callback } of channel.callbacks)
        if (filter.table === "thank_you_events") callback();
  });
  await flush();
  assert.equal(
    view.container.querySelectorAll(".timeline-row:not(.empty)").length,
    40,
  );
  assert.match(view.container.textContent, /older comment/);
  await view.close();
});

test("customer voices are not truncated at 50 records", async () => {
  fixture({
    chatwork_good_voices: Array.from({ length: 65 }, (_, i) => ({
      id: `voice-${i}`,
      message_body: `Voice ${i}`,
      sent_at: `2026-10-${String((i % 12) + 1).padStart(2, "0")}T00:00:00Z`,
      author_name: "Test",
    })),
  });
  const view = await mount(pages.DashboardPage, {});
  assert.match(
    view.container.querySelector(".good-voices-count").textContent,
    /65/,
  );
  assert.equal(view.container.querySelectorAll(".good-voice-row").length, 65);
  await view.close();
});

test("decimal adjustments are rejected instead of becoming a different integer", async () => {
  const state = fixture();
  const view = await mount(pages.AdminPage, { section: "adjustment" });
  const input = view.container.querySelector('input[placeholder="+1,000 / -300"]');
  await change(input, "-1.5");
  await blur(input);
  assert.equal(input.value, "-1.5");
  await click(button(view.container, "補正を登録"));
  assert.match(view.container.textContent, /補正数は0以外の整数/);
  assert.equal(state.writes.length, 0);
  await view.close();
});

test("reversed period dates are rejected before saving", async () => {
  const state = fixture();
  const view = await mount(pages.SettingsPage, { section: "period" });
  await click(view.container.querySelectorAll(".date-field")[0]);
  for (let month = 0; month < 6; month += 1) {
    await click(view.container.querySelector('[aria-label="次の月"]'));
  }
  const day = [...view.container.querySelectorAll(".calendar-day:not(.outside)")].find((element) => element.textContent === "1");
  await click(day);
  await click(button(view.container, "期設定を保存"));
  assert.match(view.container.textContent, /終了日は開始日以降/);
  assert.equal(state.writes.length, 0);
  await view.close();
});
