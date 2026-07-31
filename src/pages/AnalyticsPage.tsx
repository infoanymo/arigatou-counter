import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, RefreshCcw } from "lucide-react";
import type { ThankYouAdjustment, ThankYouEvent } from "../lib/database.types";
import { formatNumber } from "../lib/format";
import { getSupabase } from "../lib/supabase";

type MonthlySummary = {
  key: string;
  label: string;
  eventCount: number;
  adjustmentTotal: number;
  total: number;
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

export function AnalyticsPage() {
  const [events, setEvents] = useState<ThankYouEvent[]>([]);
  const [adjustments, setAdjustments] = useState<ThankYouAdjustment[]>([]);
  const [startDate, setStartDate] = useState(monthStart(today));
  const [endDate, setEndDate] = useState(today);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    const client = getSupabase();
    setLoading(true);
    setMessage(null);

    const [eventsResult, adjustmentsResult] = await Promise.all([
      client
        .from("thank_you_events")
        .select("id,period_id,user_id,created_at")
        .order("created_at", { ascending: false })
        .limit(20000)
        .returns<ThankYouEvent[]>(),
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

  return (
    <div className="analytics-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Analytics</p>
          <h1>期間分析</h1>
          <p>月ごとの推移と、指定期間のありがとう件数を確認します。</p>
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

      <section className="analytics-summary-grid" aria-label="分析サマリー">
        <article className="stat-tile">
          <BarChart3 aria-hidden="true" />
          <span>全期間合計</span>
          <strong>{loading ? "-" : formatNumber(Math.max(0, allTimeTotal))}</strong>
        </article>
        <article className="stat-tile">
          <CalendarDays aria-hidden="true" />
          <span>指定期間合計</span>
          <strong>
            {loading || rangeSummary.invalid ? "-" : formatNumber(rangeSummary.total)}
          </strong>
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
          <label>
            <span>開始日</span>
            <input
              onChange={(event) => setStartDate(event.target.value)}
              type="date"
              value={startDate}
            />
          </label>
          <label>
            <span>終了日</span>
            <input
              onChange={(event) => setEndDate(event.target.value)}
              type="date"
              value={endDate}
            />
          </label>
        </div>
        {rangeSummary.invalid ? (
          <p className="notice error">終了日は開始日以降にしてください。</p>
        ) : (
          <div className="adjustment-summary" aria-label="指定期間の内訳">
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
          </div>
        )}
      </section>

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
    </div>
  );
}
