import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { BarChart3, CalendarDays, RefreshCcw, UserRound } from "lucide-react";
import type {
  Profile,
  ThankYouAdjustment,
  ThankYouEvent,
} from "../lib/database.types";
import { formatDateTime, formatNumber } from "../lib/format";
import { getSupabase } from "../lib/supabase";
import { ProfileAvatar } from "../components/ProfileAvatar";
import {
  DatePickerField,
  formatDateLabel,
} from "../components/DatePickerField";
import { analyticsDateRange, japanDateValue } from "../lib/analytics";
import { loadAllRows } from "../lib/pagination";
import {
  RequestTimeoutError,
  withRequestDeadline,
} from "../lib/abortable-request";

type MonthlySummary = {
  key: string;
  label: string;
  eventCount: number;
  adjustmentTotal: number;
  total: number;
};

type AnalyticsSection = "period" | "person";

type AnalyticsEvent = Pick<ThankYouEvent, "id" | "user_id" | "created_at">;
type AnalyticsAdjustment = Pick<
  ThankYouAdjustment,
  "id" | "delta" | "created_at"
>;
type AnalyticsProfile = Pick<
  Profile,
  | "id"
  | "display_name"
  | "email"
  | "company_name"
  | "avatar_url"
  | "avatar_scale"
>;
type PersonSummary = {
  userId: string;
  name: string;
  email?: string;
  companyName?: string;
  avatarUrl?: string | null;
  avatarScale?: number;
  total: number;
  rangeCount: number;
  latestAt: string;
};

function monthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

const monthFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
});

function monthKey(value: string) {
  const parts = monthFormatter.formatToParts(new Date(value));
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${year}-${month}`;
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  return `${year}年${Number(month)}月`;
}

export function AnalyticsPage({ section }: { section: AnalyticsSection }) {
  const [today] = useState(japanDateValue);
  const loadRequestId = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const profileRequest = useRef<AbortController | null>(null);
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [adjustments, setAdjustments] = useState<AnalyticsAdjustment[]>([]);
  const [startDate, setStartDate] = useState(monthStart(today));
  const [endDate, setEndDate] = useState(today);
  const [draftStartDate, setDraftStartDate] = useState(monthStart(today));
  const [draftEndDate, setDraftEndDate] = useState(today);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const loading = status === "loading";
  const hasResult = status === "ready";

  const loadAnalytics = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    activeRequest.current?.abort();
    profileRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setStatus("loading");
    setMessage(null);

    const snapshotAt = new Date().toISOString();
    try {
      const client = getSupabase();
      const [nextEvents, nextAdjustments] = await withRequestDeadline(
        (signal) =>
          Promise.all([
            loadAllRows<AnalyticsEvent>((from, to) =>
              client
                .from("thank_you_events")
                .select(
                  "id,user_id,created_at",
                  from === 0 ? { count: "exact" } : {},
                )
                .eq("kind", "thank_you")
                .lte("created_at", snapshotAt)
                .order("created_at", { ascending: false })
                .order("id", { ascending: false })
                .range(from, to)
                .abortSignal(signal)
                .returns<AnalyticsEvent[]>(),
            ),
            loadAllRows<AnalyticsAdjustment>((from, to) =>
              client
                .from("thank_you_adjustments")
                .select(
                  "id,delta,created_at",
                  from === 0 ? { count: "exact" } : {},
                )
                .lte("created_at", snapshotAt)
                .order("created_at", { ascending: false })
                .order("id", { ascending: false })
                .range(from, to)
                .abortSignal(signal)
                .returns<AnalyticsAdjustment[]>(),
            ),
          ]),
        controller.signal,
      );

      if (requestId !== loadRequestId.current) return;
      setEvents(nextEvents);
      setAdjustments(nextAdjustments);
      setStatus("ready");
    } catch (error) {
      if (requestId !== loadRequestId.current) return;
      if (controller.signal.aborted) return;
      setStatus("error");
      setMessage(
        error instanceof RequestTimeoutError
          ? error.message
          : "分析データを読み込めませんでした。更新ボタンで再試行してください。",
      );
      setEvents([]);
      setAdjustments([]);
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, []);

  useEffect(() => {
    void loadAnalytics();
    return () => {
      ++loadRequestId.current;
      activeRequest.current?.abort();
      profileRequest.current?.abort();
    };
  }, [loadAnalytics]);

  const eventUserIds = useMemo(
    () => [...new Set(events.map((event) => event.user_id))],
    [events],
  );
  const eventUserKey = eventUserIds.join(",");
  const [profiles, setProfiles] = useState<Map<string, AnalyticsProfile>>(
    new Map(),
  );

  useEffect(() => {
    setProfileMessage(null);
    if (section !== "person" || !hasResult || !eventUserIds.length) return;
    const controller = new AbortController();
    profileRequest.current = controller;
    const client = getSupabase();
    void withRequestDeadline(async (signal) => {
      const nextProfiles = new Map<string, AnalyticsProfile>();
      for (let offset = 0; offset < eventUserIds.length; offset += 100) {
        const batch = eventUserIds.slice(offset, offset + 100);
        const rows = await loadAllRows<AnalyticsProfile>((from, to) =>
          client
            .from("profiles")
            .select(
              "id,display_name,email,company_name,avatar_url,avatar_scale",
              from === 0 ? { count: "exact" } : {},
            )
            .in("id", batch)
            .order("id")
            .range(from, to)
            .abortSignal(signal)
            .returns<AnalyticsProfile[]>(),
        );
        for (const profile of rows) nextProfiles.set(profile.id, profile);
      }
      return nextProfiles;
    }, controller.signal)
      .then((nextProfiles) => {
        if (!controller.signal.aborted) setProfiles(nextProfiles);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setProfileMessage(
            "人物名・画像を読み込めませんでした。集計件数は取得済みです。更新ボタンで再試行してください。",
          );
      });
    return () => controller.abort();
  }, [section, hasResult, eventUserKey]);

  const monthlySummaries = useMemo(() => {
    const summaries = new Map<string, MonthlySummary>();

    function getSummary(key: string) {
      const existing = summaries.get(key);
      if (existing) return existing;
      const next = {
        key,
        label: monthLabel(key),
        eventCount: 0,
        adjustmentTotal: 0,
        total: 0,
      };
      summaries.set(key, next);
      return next;
    }

    for (const event of events) {
      const summary = getSummary(monthKey(event.created_at));
      summary.eventCount += 1;
      summary.total += 1;
    }

    for (const adjustment of adjustments) {
      const summary = getSummary(monthKey(adjustment.created_at));
      summary.adjustmentTotal += adjustment.delta;
      summary.total += adjustment.delta;
    }

    return [...summaries.values()].sort((a, b) => b.key.localeCompare(a.key));
  }, [adjustments, events]);

  const rangeSummary = useMemo(() => {
    const { start, endExclusive, invalid } = analyticsDateRange(
      startDate,
      endDate,
    );

    if (invalid) {
      return {
        eventCount: 0,
        adjustmentTotal: 0,
        total: 0,
        invalid: true,
      };
    }

    const eventCount = events.filter((event) => {
      const createdAt = new Date(event.created_at).getTime();
      return createdAt >= start && createdAt < endExclusive;
    }).length;

    const adjustmentTotal = adjustments.reduce((sum, adjustment) => {
      const createdAt = new Date(adjustment.created_at).getTime();
      if (createdAt < start || createdAt >= endExclusive) return sum;
      return sum + adjustment.delta;
    }, 0);

    return {
      eventCount,
      adjustmentTotal,
      total: Math.max(0, eventCount + adjustmentTotal),
      invalid: false,
    };
  }, [adjustments, endDate, events, startDate]);

  const allTimeTotal = monthlySummaries.reduce(
    (sum, item) => sum + item.total,
    0,
  );
  const personSummaries = useMemo(() => {
    const { start, endExclusive } = analyticsDateRange(startDate, endDate);
    const summaries = new Map<string, PersonSummary>();

    for (const event of events) {
      const createdAt = new Date(event.created_at).getTime();
      const profile = profiles.get(event.user_id);
      const current = summaries.get(event.user_id);
      const base: PersonSummary = current ?? {
        userId: event.user_id,
        name: profile?.display_name || profile?.email || "メンバー",
        email: profile?.email ?? undefined,
        companyName: profile?.company_name ?? undefined,
        avatarUrl: profile?.avatar_url,
        avatarScale: profile?.avatar_scale,
        total: 0,
        rangeCount: 0,
        latestAt: event.created_at,
      };

      base.total += 1;
      if (
        !rangeSummary.invalid &&
        createdAt >= start &&
        createdAt < endExclusive
      ) {
        base.rangeCount += 1;
      }
      if (event.created_at > base.latestAt) base.latestAt = event.created_at;
      summaries.set(event.user_id, base);
    }

    return [...summaries.values()].sort(
      (a, b) =>
        b.rangeCount - a.rangeCount ||
        b.total - a.total ||
        b.latestAt.localeCompare(a.latestAt),
    );
  }, [endDate, events, profiles, rangeSummary.invalid, startDate]);

  const rangePersonCount = personSummaries.filter(
    (person) => person.rangeCount > 0,
  ).length;
  const topPerson = personSummaries.find((person) => person.rangeCount > 0);
  const maxRangeCount = Math.max(
    1,
    ...personSummaries.map((person) => person.rangeCount),
  );
  const isPeriodSection = section === "period";
  const draftInvalid = analyticsDateRange(draftStartDate, draftEndDate).invalid;
  const rangeDirty = draftStartDate !== startDate || draftEndDate !== endDate;

  function applyDateRange() {
    if (!hasResult) return;
    if (draftInvalid) {
      setMessage("終了日は開始日以降にしてください。");
      return;
    }

    setStartDate(draftStartDate);
    setEndDate(draftEndDate);
    setMessage(null);
  }

  return (
    <div className="analytics-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Analytics</p>
          <h1>{isPeriodSection ? "期間分析" : "人物分析"}</h1>
          <p>
            {isPeriodSection
              ? "月ごとの推移と、指定期間のありがとう件数を確認します。"
              : "メンバーごとのありがとう件数と、指定期間内の動きを確認します。"}
          </p>
        </div>
        <button
          className="button button-secondary"
          disabled={loading}
          onClick={() => void loadAnalytics()}
          type="button"
        >
          <RefreshCcw aria-hidden="true" />
          {loading ? "集計中..." : "更新"}
        </button>
      </header>

      {message ? <p className="notice error">{message}</p> : null}
      {section === "person" && profileMessage ? (
        <p className="notice error">{profileMessage}</p>
      ) : null}

      <nav className="admin-tabs" aria-label="分析メニュー">
        <NavLink to="/analytics/period">
          <CalendarDays aria-hidden="true" />
          期間
        </NavLink>
        <NavLink to="/analytics/person">
          <UserRound aria-hidden="true" />
          人物
        </NavLink>
      </nav>

      <section className="analytics-summary-grid" aria-label="分析サマリー">
        <article className="stat-tile">
          {isPeriodSection ? (
            <>
              <BarChart3 aria-hidden="true" />
              <span>全期間合計</span>
              <strong>
                {hasResult ? formatNumber(Math.max(0, allTimeTotal)) : "-"}
              </strong>
            </>
          ) : (
            <>
              <UserRound aria-hidden="true" />
              <span>分析対象人数</span>
              <strong>
                {hasResult ? formatNumber(personSummaries.length) : "-"}
              </strong>
            </>
          )}
        </article>
        <article className="stat-tile">
          {isPeriodSection ? (
            <>
              <CalendarDays aria-hidden="true" />
              <span>指定期間合計</span>
              <strong>
                {!hasResult || rangeSummary.invalid
                  ? "-"
                  : formatNumber(rangeSummary.total)}
              </strong>
            </>
          ) : (
            <>
              <BarChart3 aria-hidden="true" />
              <span>期間内トップ</span>
              <strong>
                {!hasResult || !topPerson
                  ? "-"
                  : formatNumber(topPerson.rangeCount)}
              </strong>
            </>
          )}
        </article>
      </section>

      <section className="panel analytics-filter-panel">
        <div className="panel-title">
          <CalendarDays aria-hidden="true" />
          <div>
            <p className="eyebrow">Date Range</p>
            <h2>期間で絞り込み</h2>
          </div>
        </div>
        <div className="analytics-filter-grid">
          <DatePickerField
            label="開始日"
            onChange={setDraftStartDate}
            value={draftStartDate}
          />
          <DatePickerField
            label="終了日"
            onChange={setDraftEndDate}
            value={draftEndDate}
          />
        </div>
        <div className="analytics-apply-row">
          <p role="status" aria-live="polite">
            {loading
              ? "データを読み込んで集計しています..."
              : !hasResult
                ? "集計できませんでした。更新ボタンで再試行してください。"
                : rangeDirty
                  ? "日付を選択中です。適用すると下の数値が更新されます。"
                  : `${formatDateLabel(startDate)} から ${formatDateLabel(endDate)} の集計が完了しました。`}
          </p>
          <button
            className="button button-primary"
            disabled={!hasResult || draftInvalid || !rangeDirty}
            onClick={applyDateRange}
            type="button"
          >
            <CalendarDays aria-hidden="true" />
            適用
          </button>
        </div>
        {draftInvalid ? (
          <p className="notice error">終了日は開始日以降にしてください。</p>
        ) : (
          <div
            className={`adjustment-summary ${!isPeriodSection ? "four-columns" : ""}`}
            aria-label="指定期間の内訳"
          >
            <div>
              <span>押下数</span>
              <strong>
                {hasResult ? formatNumber(rangeSummary.eventCount) : "-"}
              </strong>
            </div>
            <div>
              <span>補正</span>
              <strong>
                {hasResult && rangeSummary.adjustmentTotal > 0 ? "+" : ""}
                {hasResult ? formatNumber(rangeSummary.adjustmentTotal) : "-"}
              </strong>
            </div>
            <div>
              <span>表示総数</span>
              <strong>
                {hasResult ? formatNumber(rangeSummary.total) : "-"}
              </strong>
            </div>
            {!isPeriodSection ? (
              <div>
                <span>対象人数</span>
                <strong>
                  {hasResult ? formatNumber(rangePersonCount) : "-"}
                </strong>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {isPeriodSection ? (
        <section className="panel">
          <div className="panel-title">
            <BarChart3 aria-hidden="true" />
            <div>
              <p className="eyebrow">Monthly</p>
              <h2>月ごとの合計</h2>
            </div>
          </div>
          {loading ? (
            <p className="muted">読み込み中...</p>
          ) : !hasResult ? (
            <p className="muted">集計結果を取得できませんでした。</p>
          ) : monthlySummaries.length ? (
            <div className="monthly-list">
              {monthlySummaries.map((item) => {
                const maxTotal = Math.max(
                  1,
                  ...monthlySummaries.map((summary) =>
                    Math.max(0, summary.total),
                  ),
                );
                const width = `${Math.max(4, (Math.max(0, item.total) / maxTotal) * 100)}%`;
                return (
                  <article className="monthly-row" key={item.key}>
                    <div>
                      <strong>{item.label}</strong>
                      <span>
                        押下 {formatNumber(item.eventCount)} 件 / 補正{" "}
                        {item.adjustmentTotal > 0 ? "+" : ""}
                        {formatNumber(item.adjustmentTotal)} 件
                      </span>
                    </div>
                    <em>{formatNumber(Math.max(0, item.total))}件</em>
                    <div className="monthly-bar" aria-hidden="true">
                      <span style={{ width }} />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="muted">まだ集計できるありがとうがありません。</p>
          )}
        </section>
      ) : (
        <section className="panel">
          <div className="panel-title">
            <UserRound aria-hidden="true" />
            <div>
              <p className="eyebrow">People</p>
              <h2>人物ごとの件数</h2>
            </div>
          </div>
          {loading ? (
            <p className="muted">読み込み中...</p>
          ) : !hasResult ? (
            <p className="muted">集計結果を取得できませんでした。</p>
          ) : personSummaries.length ? (
            <div className="people-list">
              {personSummaries.map((person) => {
                const width = `${Math.max(4, (person.rangeCount / maxRangeCount) * 100)}%`;
                return (
                  <article className="person-row" key={person.userId}>
                    <ProfileAvatar
                      name={person.name}
                      src={person.avatarUrl}
                      avatarScale={person.avatarScale}
                    />
                    <div className="person-main">
                      <strong>{person.name}</strong>
                      <span>
                        {person.companyName ? `${person.companyName} / ` : ""}
                        直近 {formatDateTime(person.latestAt)}
                      </span>
                      <div className="monthly-bar" aria-hidden="true">
                        <span style={{ width }} />
                      </div>
                    </div>
                    <div className="person-counts">
                      <span>期間内</span>
                      <strong>{formatNumber(person.rangeCount)}</strong>
                      <span>累計 {formatNumber(person.total)}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="muted">まだ集計できるメンバーがいません。</p>
          )}
        </section>
      )}
    </div>
  );
}
