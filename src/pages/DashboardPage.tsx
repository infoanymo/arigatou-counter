import confetti from "canvas-confetti";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Crown,
  HeartHandshake,
  Radio,
  Sparkles,
  Target,
  Trophy,
} from "lucide-react";
import type {
  Period,
  Profile,
  ThankYouAdjustment,
  ThankYouEvent,
} from "../lib/database.types";
import { formatDate, formatDateTime, formatNumber, daysUntil } from "../lib/format";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { ProfileAvatar } from "../components/ProfileAvatar";

type EventWithProfile = ThankYouEvent & {
  profiles: Pick<Profile, "display_name" | "email" | "company_name" | "avatar_url"> | null;
};

type RealtimeStatus = "connecting" | "connected" | "disconnected";

function useAnimatedNumber(value: number) {
  const [displayValue, setDisplayValue] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    const start = previous.current;
    previous.current = value;

    if (start === value) {
      setDisplayValue(value);
      return undefined;
    }

    const startAt = performance.now();
    const duration = 650;
    let frame = 0;

    function tick(now: number) {
      const progress = Math.min(1, (now - startAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(start + (value - start) * eased));

      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return displayValue;
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function nameForEvent(event: EventWithProfile) {
  return event.profiles?.display_name || event.profiles?.email || "メンバー";
}

export function DashboardPage() {
  const { user, profile } = useAuth();
  const [period, setPeriod] = useState<Period | null>(null);
  const [events, setEvents] = useState<EventWithProfile[]>([]);
  const [adjustments, setAdjustments] = useState<ThankYouAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] =
    useState<RealtimeStatus>("connecting");
  const [bursts, setBursts] = useState<Array<{ id: number; left: number }>>([]);
  const burstId = useRef(0);

  const loadEvents = useCallback(async (periodId: string) => {
    const client = getSupabase();
    const { data, error: eventsError } = await client
      .from("thank_you_events")
      .select(
        "id, period_id, user_id, created_at, profiles:profiles!thank_you_events_user_id_fkey(display_name,email,company_name,avatar_url)",
      )
      .eq("period_id", periodId)
      .order("created_at", { ascending: false })
      .limit(5000)
      .returns<EventWithProfile[]>();

    if (eventsError) {
      setError("ありがとう履歴を読み込めませんでした。");
      return;
    }

    setEvents(data ?? []);
  }, []);

  const loadAdjustments = useCallback(async (periodId: string) => {
    const client = getSupabase();
    const { data, error: adjustmentsError } = await client
      .from("thank_you_adjustments")
      .select("id, period_id, admin_user_id, delta, reason, created_at")
      .eq("period_id", periodId)
      .order("created_at", { ascending: false })
      .returns<ThankYouAdjustment[]>();

    if (adjustmentsError) {
      setError("ありがとう補正を読み込めませんでした。");
      return;
    }

    setAdjustments(data ?? []);
  }, []);

  const loadDashboard = useCallback(async () => {
    const client = getSupabase();
    setLoading(true);
    setError(null);

    const { data: activePeriod, error: periodError } = await client
      .from("periods")
      .select("*")
      .eq("is_active", true)
      .order("starts_on", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (periodError) {
      setError("今期設定を読み込めませんでした。");
      setLoading(false);
      return;
    }

    setPeriod(activePeriod);

    if (activePeriod) {
      await Promise.all([
        loadEvents(activePeriod.id),
        loadAdjustments(activePeriod.id),
      ]);
    } else {
      setEvents([]);
      setAdjustments([]);
    }

    setLoading(false);
  }, [loadAdjustments, loadEvents]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!period) return undefined;

    const client = getSupabase();
    setRealtimeStatus("connecting");

    const channel = client
      .channel(`thank-you-events:${period.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "thank_you_events",
          filter: `period_id=eq.${period.id}`,
        },
        () => {
          setRealtimeStatus("connected");
          void loadEvents(period.id);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "thank_you_adjustments",
          filter: `period_id=eq.${period.id}`,
        },
        () => {
          setRealtimeStatus("connected");
          void loadAdjustments(period.id);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtimeStatus("connected");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setRealtimeStatus("disconnected");
          window.setTimeout(() => {
            void loadEvents(period.id);
            void loadAdjustments(period.id);
          }, 1200);
        }
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [loadAdjustments, loadEvents, period]);

  const eventTotal = events.length;
  const adjustmentTotal = useMemo(
    () => adjustments.reduce((sum, item) => sum + item.delta, 0),
    [adjustments],
  );
  const total = Math.max(0, eventTotal + adjustmentTotal);
  const totalDisplay = useAnimatedNumber(total);
  const myCount = useMemo(
    () => events.filter((event) => event.user_id === user?.id).length,
    [events, user?.id],
  );
  const progress = period ? Math.min(100, (total / period.target_count) * 100) : 0;
  const roundedProgress = Math.round(progress);
  const progressDegrees = Math.round((progress / 100) * 360);

  const ranking = useMemo(() => {
    const result = new Map<
      string,
      {
        userId: string;
        name: string;
        email?: string;
        companyName?: string;
        avatarUrl?: string;
        count: number;
        lastAt: string;
      }
    >();

    for (const event of events) {
      const current = result.get(event.user_id);
      if (current) {
        current.count += 1;
        if (event.created_at > current.lastAt) current.lastAt = event.created_at;
      } else {
        result.set(event.user_id, {
          userId: event.user_id,
          name: nameForEvent(event),
          email: event.profiles?.email ?? undefined,
          companyName: event.profiles?.company_name ?? undefined,
          avatarUrl: event.profiles?.avatar_url ?? undefined,
          count: 1,
          lastAt: event.created_at,
        });
      }
    }

    return [...result.values()]
      .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
      .slice(0, 10);
  }, [events]);

  function runCelebration() {
    if (!reducedMotion()) {
      void confetti({
        colors: ["#002d55", "#2f80aa", "#f3c84b", "#dc5f4f"],
        gravity: 0.85,
        origin: { x: 0.5, y: 0.82 },
        particleCount: 58,
        spread: 64,
        startVelocity: 34,
      });
    }

    const nextBursts = Array.from({ length: reducedMotion() ? 1 : 5 }, () => ({
      id: burstId.current++,
      left: 22 + Math.random() * 56,
    }));

    setBursts((current) => [...current, ...nextBursts]);
    window.setTimeout(() => {
      setBursts((current) =>
        current.filter((burst) => !nextBursts.some((next) => next.id === burst.id)),
      );
    }, 1200);
  }

  async function handleThankYou() {
    if (!period || submitting) return;

    const client = getSupabase();
    setSubmitting(true);
    setError(null);

    const { error: insertError } = await client
      .from("thank_you_events")
      .insert({ period_id: period.id });

    if (insertError) {
      setError("登録できませんでした。少し待ってからもう一度押してください。");
      setSubmitting(false);
      return;
    }

    runCelebration();
    await loadEvents(period.id);
    window.setTimeout(() => setSubmitting(false), 450);
  }

  if (loading) {
    return (
      <section className="page-panel">
        <div className="skeleton-line wide" />
        <div className="skeleton-grid">
          <div />
          <div />
          <div />
        </div>
      </section>
    );
  }

  return (
    <div className="dashboard-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>{period?.name ?? "今期"}のありがとう</h1>
          {period ? (
            <p>
              {formatDate(period.starts_on)} - {formatDate(period.ends_on)}
            </p>
          ) : (
            <p>管理画面で期と目標を設定してください。</p>
          )}
        </div>
        <span className={`realtime-pill ${realtimeStatus}`}>
          <Radio aria-hidden="true" />
          {realtimeStatus === "connected"
            ? "リアルタイム"
            : realtimeStatus === "connecting"
              ? "接続中"
              : "再接続中"}
        </span>
      </header>

      {error ? <p className="notice error">{error}</p> : null}

      <section className="hero-band">
        <div className="hero-copy">
          <div className="metric-label">
            <HeartHandshake aria-hidden="true" />
            累計ありがとう
          </div>
          <strong>{formatNumber(totalDisplay)}</strong>
          <span>目標 {period ? formatNumber(period.target_count) : "-"} 件</span>
        </div>
        <div
          className="progress-ring"
          style={{ "--progress": `${progressDegrees}deg` } as React.CSSProperties}
          aria-label={`達成率 ${formatNumber(roundedProgress)} パーセント`}
        >
          <span>{formatNumber(roundedProgress)}%</span>
        </div>
      </section>

      <section className="action-band">
        <div>
          <p className="eyebrow">One Click</p>
          <h2>ありがとうをもらったよ</h2>
          <p>
            {profile?.display_name || user?.email || "あなた"}さんの今期カウント:
            <strong> {formatNumber(myCount)} </strong>件
          </p>
        </div>
        <button
          className="thank-you-button"
          disabled={!period || submitting}
          onClick={() => void handleThankYou()}
          type="button"
        >
          <Sparkles aria-hidden="true" />
          {submitting ? "登録中..." : "ありがとうをもらったよ"}
        </button>
        <div className="burst-layer" aria-hidden="true">
          {bursts.map((burst) => (
            <span key={burst.id} style={{ left: `${burst.left}%` }}>
              ありがとう
            </span>
          ))}
        </div>
      </section>

      <section className="stat-grid" aria-label="進捗サマリー">
        <div className="stat-tile">
          <Target aria-hidden="true" />
          <span>残り目標</span>
          <strong>
            {period ? formatNumber(Math.max(0, period.target_count - total)) : "-"}
          </strong>
        </div>
        <div className="stat-tile">
          <Activity aria-hidden="true" />
          <span>管理補正</span>
          <strong>
            {adjustmentTotal > 0 ? "+" : ""}
            {formatNumber(adjustmentTotal)}
          </strong>
        </div>
        <div className="stat-tile">
          <Trophy aria-hidden="true" />
          <span>期末まで</span>
          <strong>
            {period ? `${formatNumber(daysUntil(period.ends_on))}日` : "-"}
          </strong>
        </div>
      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="panel-title">
            <Crown aria-hidden="true" />
            <div>
              <p className="eyebrow">Ranking</p>
              <h2>個人ランキング</h2>
            </div>
          </div>
          <ol className="ranking-list">
            {ranking.length ? (
              ranking.map((entry, index) => (
                <li key={entry.userId}>
                  <span className="rank-number">{formatNumber(index + 1)}</span>
                  <ProfileAvatar name={entry.name} src={entry.avatarUrl} size="sm" />
                  <div>
                    <strong>{entry.name}</strong>
                    <span>
                      {entry.companyName ? `${entry.companyName} / ` : ""}
                      {formatDateTime(entry.lastAt)} 更新
                    </span>
                  </div>
                  <em>{formatNumber(entry.count)}</em>
                </li>
              ))
            ) : (
              <li className="empty-row">まだありがとうはありません。</li>
            )}
          </ol>
        </article>

        <article className="panel">
          <div className="panel-title">
            <HeartHandshake aria-hidden="true" />
            <div>
              <p className="eyebrow">Recent</p>
              <h2>最近のありがとう</h2>
            </div>
          </div>
          <div className="timeline">
            {events.slice(0, 8).map((event) => (
              <div className="timeline-row" key={event.id}>
                <ProfileAvatar
                  name={nameForEvent(event)}
                  src={event.profiles?.avatar_url}
                  size="sm"
                />
                <div>
                  <strong>{nameForEvent(event)}</strong>
                  <p>
                    {event.profiles?.company_name
                      ? `${event.profiles.company_name} / `
                      : ""}
                    {formatDateTime(event.created_at)}
                  </p>
                </div>
              </div>
            ))}
            {!events.length ? (
              <div className="timeline-row empty">
                <span />
                <div>
                  <strong>最初のありがとうを待っています</strong>
                  <p>ボタンを押すとここに履歴が表示されます。</p>
                </div>
              </div>
            ) : null}
          </div>
        </article>
      </section>
    </div>
  );
}
