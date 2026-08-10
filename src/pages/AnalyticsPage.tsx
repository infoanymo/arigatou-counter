import { useCallback, useEffect, useMemo, useState } from "react";
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
import { DatePickerField, formatDateLabel } from "../components/DatePickerField";

type MonthlySummary = {
  key: string;
  label: string;
  eventCount: number;
  adjustmentTotal: number;
  total: number;
};

type AnalyticsSection = "period" | "person";

type EventWithProfile = ThankYouEvent & {
  profiles: Pick<
    Profile,
    "display_name" | "email" | "company_name" | "avatar_url" | "avatar_scale"
  > | null;
};

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

const today = new Date().toISOString().slice(0, 10);

function monthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function toRangeStart(value: string) {
  return `${value}T00:00:00+09:00`;
}

function toRangeEnd(value: string) {
  return `${value}T23:59:59.999+09:00`;
}

function monthKey(value: string) {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(value));
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${year}-${month}`;
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  return `${year}年${Number(month)}月`;
}

function nameForEvent(event: EventWithProfile) {
  return event.profiles?.display_name || event.profiles?.email || "メンバー";
}

export function AnalyticsPage({ section }: { section: AnalyticsSection }) {
  const [events, setEvents] = useState<EventWithProfile[]>([]);
  const [adjustments, setAdjustments] = useState<ThankYouAdjustment[]>([]);
  const [startDate, setStartDate] = useState(monthStart(today));
  const [endDate, setEndDate] = useState(today);
  const [draftStartDate, setDraftStartDate] = useState(monthStart(today));
  const [draftEndDate, setDraftEndDate] = useState(today);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    const client = getSupabase();
    setLoading(true);
    setMessage(null);

    const [eventsResult, adjustmentsResult] = await Promise.all([
      client
        .from("thank_you_events")
        .select(
          "id,period_id,user_id,kind,message,created_at,profiles:profiles!thank_you_events_user_id_fkey(display_name,email,company_name,avatar_url,avatar_scale)",
        )
        .eq("kind", "thank_you")
        .order("created_at", { ascending: false })
        .limit(20000)
        .returns<EventWithProfile[]>(),
      client
        .from("thank_you_adjustments")
        .select("id,period_id,admin_user_id,delta,reason,created_at")
        .order("created_at", { ascending: false })
        .limit(20000)
        .returns<ThankYouAdjustment[]>(),
    ]);

    if (eventsResult.error || adjustmentsResult.error) {
      setMessage("分析データを読み込めませんでした。");
      setEvents([]);
      setAdjustments([]);
    } else {
      setEvents(eventsResult.data ?? []);
      setAdjustments(adjustmentsResult.data ?? []);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

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
    const start = new Date(toRangeStart(startDate)).getTime();
    const end = new Date(toRangeEnd(endDate)).getTime();

    if (!startDate || !endDate || start > end) {
      return {
        eventCount: 0,
        adjustmentTotal: 0,
        total: 0,
        invalid: true,
      };
    }

    const eventCount = events.filter((event) => {
      const createdAt = new Date(event.created_at).getTime();
      return createdAt >= start && createdAt <= end;
    }).length;

    const adjustmentTotal = adjustments.reduce((sum, adjustment) => {
      const createdAt = new Date(adjustment.created_at).getTime();
      if (createdAt < start || createdAt > end) return sum;
      return sum + adjustment.delta;
    }, 0);

    return {
      eventCount,
      adjustmentTotal,
      total: Math.max(0, eventCount + adjustmentTotal),
      invalid: false,
    };
  }, [adjustments, endDate, events, startDate]);

  const allTimeTotal = monthlySummaries.reduce((sum, item) => sum + item.total, 0);
  const personSummaries = useMemo(() => {
    const start = new Date(toRangeStart(startDate)).getTime();
    const end = new Date(toRangeEnd(endDate)).getTime();
    const summaries = new Map<string, PersonSummary>();

    for (const event of events) {
      const createdAt = new Date(event.created_at).getTime();
      const current = summaries.get(event.user_id);
      const base: PersonSummary =
        current ??
        {
          userId: event.user_id,
          name: nameForEvent(event),
          email: event.profiles?.email ?? undefined,
          companyName: event.profiles?.company_name ?? undefined,
          avatarUrl: event.profiles?.avatar_url,
          avatarScale: event.profiles?.avatar_scale,
          total: 0,
          rangeCount: 0,
          latestAt: event.created_at,
        };

      base.total += 1;
      if (!rangeSummary.invalid && createdAt >= start && createdAt <= end) {
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
  }, [endDate, events, rangeSummary.invalid, startDate]);

  const rangePersonCount = personSummaries.filter((person) => person.rangeCount > 0).length;
  const topPerson = personSummaries.find((person) => person.rangeCount > 0);
  const maxRangeCount = Math.max(1, ...personSummaries.map((person) => person.rangeCount));
  const isPeriodSection = section === "period";
  const draftInvalid =
    !draftStartDate ||
    !draftEndDate ||
    new Date(toRangeStart(draftStartDate)).getTime() >
      new Date(toRangeEnd(draftEndDate)).getTime();
  const rangeDirty = draftStartDate !== startDate || draftEndDate !== endDate;

  function applyDateRange() {
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
          onClick={() => void loadAnalytics()}
          type="button"
        >
          <RefreshCcw aria-hidden="true" />
          更新
        </button>
      </header>

      {message ? <p className="notice error">{message}</p> : null}

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
              <strong>{loading ? "-" : formatNumber(Math.max(0, allTimeTotal))}</strong>
            </>
          ) : (
            <>
              <UserRound aria-hidden="true" />
              <span>分析対象人数</span>
              <strong>{loading ? "-" : formatNumber(personSummaries.length)}</strong>
            </>
          )}
        </article>
        <article className="stat-tile">
          {isPeriodSection ? (
            <>
              <CalendarDays aria-hidden="true" />
              <span>指定期間合計</span>
              <strong>
                {loading || rangeSummary.invalid ? "-" : formatNumber(rangeSummary.total)}
              </strong>
            </>
          ) : (
            <>
              <BarChart3 aria-hidden="true" />
              <span>期間内トップ</span>
              <strong>{loading || !topPerson ? "-" : formatNumber(topPerson.rangeCount)}</strong>
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
          <p>
            {rangeDirty
              ? "日付を選択中です。適用すると下の数値が更新されます。"
              : `${formatDateLabel(startDate)} から ${formatDateLabel(endDate)} で集計中です。`}
          </p>
          <button
            className="button button-primary"
            disabled={draftInvalid || !rangeDirty}
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
              <strong>{formatNumber(rangeSummary.eventCount)}</strong>
            </div>
            <div>
              <span>補正</span>
              <strong>
                {rangeSummary.adjustmentTotal > 0 ? "+" : ""}
                {formatNumber(rangeSummary.adjustmentTotal)}
              </strong>
            </div>
            <div>
              <span>表示総数</span>
              <strong>{formatNumber(rangeSummary.total)}</strong>
            </div>
            {!isPeriodSection ? (
              <div>
                <span>対象人数</span>
                <strong>{formatNumber(rangePersonCount)}</strong>
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
          ) : monthlySummaries.length ? (
            <div className="monthly-list">
              {monthlySummaries.map((item) => {
                const maxTotal = Math.max(
                  1,
                  ...monthlySummaries.map((summary) => Math.max(0, summary.total)),
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
