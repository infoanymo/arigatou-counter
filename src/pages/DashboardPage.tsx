import confetti from "canvas-confetti";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Crown,
  HeartHandshake,
  MessageCircle,
  Pencil,
  Radio,
  Send,
  Sparkles,
  Target,
  ThumbsUp,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import type {
  Period,
  Profile,
  ThankYouAdjustment,
  ThankYouComment,
  ThankYouEvent,
} from "../lib/database.types";
import { formatDate, formatDateTime, formatNumber, daysUntil } from "../lib/format";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { ProfileAvatar } from "../components/ProfileAvatar";

type EventWithProfile = ThankYouEvent & {
  profiles: Pick<
    Profile,
    "display_name" | "email" | "company_name" | "avatar_url" | "avatar_scale"
  > | null;
};

type ReactionKey =
  | "like"
  | "love"
  | "clap"
  | "celebrate"
  | "thanks"
  | "strong"
  | "sparkle"
  | "heart_eyes";

type ProfileSummary = Pick<
  Profile,
  "display_name" | "email" | "company_name" | "avatar_url" | "avatar_scale"
>;

const REACTION_OPTIONS: Array<{
  key: ReactionKey;
  emoji: string;
  label: string;
}> = [
  { key: "like", emoji: "👍", label: "いいね" },
  { key: "love", emoji: "❤️", label: "大好き" },
  { key: "clap", emoji: "👏", label: "拍手" },
  { key: "celebrate", emoji: "🎉", label: "お祝い" },
  { key: "thanks", emoji: "🙏", label: "感謝" },
  { key: "strong", emoji: "💪", label: "応援" },
  { key: "sparkle", emoji: "✨", label: "すてき" },
  { key: "heart_eyes", emoji: "🥰", label: "うれしい" },
];

type CommentWithProfile = ThankYouComment & {
  profiles: ProfileSummary | null;
};

type ReactionWithProfile = {
  event_id: string;
  user_id: string;
  reaction: ReactionKey;
  profiles: ProfileSummary | null;
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

function emptyReactionCounts() {
  return Object.fromEntries(
    REACTION_OPTIONS.map((option) => [option.key, 0]),
  ) as Record<ReactionKey, number>;
}

function emptyReactionUsers() {
  return Object.fromEntries(
    REACTION_OPTIONS.map((option) => [option.key, []]),
  ) as unknown as Record<ReactionKey, ProfileSummary[]>;
}

export function DashboardPage() {
  const { user, profile } = useAuth();
  const [period, setPeriod] = useState<Period | null>(null);
  const [events, setEvents] = useState<EventWithProfile[]>([]);
  const [adjustments, setAdjustments] = useState<ThankYouAdjustment[]>([]);
  const [likesByEvent, setLikesByEvent] = useState<
    Record<
      string,
      {
        count: number;
        reactionCounts: Record<ReactionKey, number>;
        reactionByMe: ReactionKey[];
        reactionUsers: Record<ReactionKey, ProfileSummary[]>;
      }
    >
  >({});
  const [commentsByEvent, setCommentsByEvent] = useState<
    Record<string, CommentWithProfile[]>
  >({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [postDraft, setPostDraft] = useState("");
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editPostDraft, setEditPostDraft] = useState("");
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  const [reactionPeopleKey, setReactionPeopleKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingPost, setSavingPost] = useState(false);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [savingCommentId, setSavingCommentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] =
    useState<RealtimeStatus>("connecting");
  const [bursts, setBursts] = useState<
    Array<{ id: number; left: number; fontFamily: string }>
  >([]);
  const burstId = useRef(0);

  const loadInteractions = useCallback(
    async (eventIds: string[]) => {
      const client = getSupabase();

      if (!eventIds.length) {
        setLikesByEvent({});
        setCommentsByEvent({});
        return;
      }

      const [likesResult, commentsResult] = await Promise.all([
        client
          .from("thank_you_likes")
          .select(
            "event_id,user_id,reaction,profiles:profiles!thank_you_likes_user_id_fkey(display_name,email,company_name,avatar_url,avatar_scale)",
          )
          .in("event_id", eventIds),
        client
          .from("thank_you_comments")
          .select(
            "id,event_id,user_id,body,created_at,profiles:profiles!thank_you_comments_user_id_fkey(display_name,email,company_name,avatar_url,avatar_scale)",
          )
          .in("event_id", eventIds)
          .order("created_at", { ascending: true })
          .returns<CommentWithProfile[]>(),
      ]);

      if (likesResult.error || commentsResult.error) {
        setError("いいね・コメントを読み込めませんでした。");
        return;
      }

      const nextLikes = Object.fromEntries(
        eventIds.map((eventId) => [
          eventId,
          {
            count: 0,
            reactionCounts: emptyReactionCounts(),
            reactionByMe: [],
            reactionUsers: emptyReactionUsers(),
          },
        ]),
      ) as Record<
        string,
        {
          count: number;
          reactionCounts: Record<ReactionKey, number>;
          reactionByMe: ReactionKey[];
          reactionUsers: Record<ReactionKey, ProfileSummary[]>;
        }
      >;

      for (const like of (likesResult.data ?? []) as ReactionWithProfile[]) {
        const current = nextLikes[like.event_id] ?? {
          count: 0,
          reactionCounts: emptyReactionCounts(),
          reactionByMe: [],
          reactionUsers: emptyReactionUsers(),
        };
        const reaction = like.reaction as ReactionKey;
        current.count += 1;
        current.reactionCounts[reaction] = (current.reactionCounts[reaction] ?? 0) + 1;
        if (like.profiles) {
          current.reactionUsers[reaction] = [
            ...current.reactionUsers[reaction],
            like.profiles,
          ];
        }
        if (like.user_id === user?.id && !current.reactionByMe.includes(reaction)) {
          current.reactionByMe = [...current.reactionByMe, reaction];
        }
        nextLikes[like.event_id] = current;
      }

      const nextComments = Object.fromEntries(
        eventIds.map((eventId) => [eventId, []]),
      ) as Record<string, CommentWithProfile[]>;

      for (const comment of commentsResult.data ?? []) {
        nextComments[comment.event_id] = [
          ...(nextComments[comment.event_id] ?? []),
          comment,
        ];
      }

      setLikesByEvent(nextLikes);
      setCommentsByEvent(nextComments);
    },
    [user?.id],
  );

  const loadEvents = useCallback(async (periodId: string) => {
    const client = getSupabase();
    const { data, error: eventsError } = await client
      .from("thank_you_events")
      .select(
        "id, period_id, user_id, kind, message, created_at, profiles:profiles!thank_you_events_user_id_fkey(display_name,email,company_name,avatar_url,avatar_scale)",
      )
      .eq("period_id", periodId)
      .order("created_at", { ascending: false })
      .limit(5000)
      .returns<EventWithProfile[]>();

    if (eventsError) {
      setError("ありがとう履歴を読み込めませんでした。");
      return;
    }

    const nextEvents = data ?? [];
    setEvents(nextEvents);
    await loadInteractions(nextEvents.slice(0, 8).map((event) => event.id));
  }, [loadInteractions]);

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
          event: "*",
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
          event: "*",
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

  const recentEvents = useMemo(() => events.slice(0, 8), [events]);
  const recentEventIds = useMemo(
    () => recentEvents.map((event) => event.id),
    [recentEvents],
  );
  const recentEventKey = recentEventIds.join("|");

  useEffect(() => {
    if (!period) return undefined;

    const client = getSupabase();
    const channel = client
      .channel(`thank-you-interactions:${period.id}:${recentEventKey}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "thank_you_likes" },
        () => {
          void loadInteractions(recentEventIds);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "thank_you_comments" },
        () => {
          void loadInteractions(recentEventIds);
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [loadInteractions, period, recentEventIds, recentEventKey]);

  const thankYouEvents = useMemo(
    () => events.filter((event) => event.kind === "thank_you"),
    [events],
  );
  const eventTotal = thankYouEvents.length;
  const adjustmentTotal = useMemo(
    () => adjustments.reduce((sum, item) => sum + item.delta, 0),
    [adjustments],
  );
  const total = Math.max(0, eventTotal + adjustmentTotal);
  const totalDisplay = useAnimatedNumber(total);
  const myCount = useMemo(
    () => thankYouEvents.filter((event) => event.user_id === user?.id).length,
    [thankYouEvents, user?.id],
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
        avatarScale?: number;
        count: number;
        lastAt: string;
      }
    >();

    for (const event of thankYouEvents) {
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
          avatarScale: event.profiles?.avatar_scale ?? undefined,
          count: 1,
          lastAt: event.created_at,
        });
      }
    }

    const sorted = [...result.values()]
      .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
      .slice(0, 5);

    let previousCount: number | undefined;
    let previousRank = 0;

    return sorted.map((entry, index) => {
      const rank = entry.count === previousCount ? previousRank : index + 1;
      previousCount = entry.count;
      previousRank = rank;
      return { ...entry, rank };
    });
  }, [thankYouEvents]);

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

    const burstFonts = [
      "Inter, 'Noto Sans JP', sans-serif",
      "'Yu Mincho', 'Hiragino Mincho ProN', serif",
      "'Hiragino Maru Gothic ProN', 'Yu Gothic', sans-serif",
      "'Yu Gothic', 'Noto Sans JP', sans-serif",
      "Georgia, 'Yu Mincho', serif",
    ];
    const nextBursts = Array.from({ length: reducedMotion() ? 1 : 5 }, () => ({
      id: burstId.current++,
      left: 22 + Math.random() * 56,
      fontFamily: burstFonts[Math.floor(Math.random() * burstFonts.length)],
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

  async function toggleReaction(eventId: string, reaction: ReactionKey) {
    const client = getSupabase();
    const current = likesByEvent[eventId];

    setError(null);

    const result = current?.reactionByMe.includes(reaction)
      ? await client
          .from("thank_you_likes")
          .delete()
          .eq("event_id", eventId)
          .eq("user_id", user?.id ?? "")
          .eq("reaction", reaction)
      : await client.from("thank_you_likes").insert({ event_id: eventId, reaction });

    if (result.error) {
      setError("いいねを更新できませんでした。");
      return;
    }

    await loadInteractions(recentEventIds);
    setReactionPickerId(null);
  }

  function startEditingPost(post: EventWithProfile) {
    if (post.kind !== "community_post" || post.user_id !== user?.id) return;
    setEditingPostId(post.id);
    setEditPostDraft(post.message ?? "");
    setReactionPickerId(null);
  }

  function cancelEditingPost() {
    setEditingPostId(null);
    setEditPostDraft("");
  }

  async function handleCommunityPostUpdate(
    event: React.FormEvent<HTMLFormElement>,
    postId: string,
  ) {
    event.preventDefault();
    const body = editPostDraft.trim();
    if (!body || savingEditId) return;

    const client = getSupabase();
    setSavingEditId(postId);
    setError(null);

    const { error: updateError } = await client
      .from("thank_you_events")
      .update({ message: body })
      .eq("id", postId)
      .eq("user_id", user?.id ?? "")
      .eq("kind", "community_post");

    if (updateError) {
      setError("全体投稿を更新できませんでした。権限を確認してください。");
    } else {
      cancelEditingPost();
      if (period) await loadEvents(period.id);
    }

    setSavingEditId(null);
  }

  async function handleCommunityPostDelete(post: EventWithProfile) {
    if (post.kind !== "community_post" || post.user_id !== user?.id || deletingPostId) {
      return;
    }
    if (!window.confirm("この全体投稿を削除しますか？")) return;

    const client = getSupabase();
    setDeletingPostId(post.id);
    setError(null);

    const { error: deleteError } = await client
      .from("thank_you_events")
      .delete()
      .eq("id", post.id)
      .eq("user_id", user?.id ?? "")
      .eq("kind", "community_post");

    if (deleteError) {
      setError("全体投稿を削除できませんでした。権限を確認してください。");
    } else {
      if (editingPostId === post.id) cancelEditingPost();
      if (period) await loadEvents(period.id);
    }

    setDeletingPostId(null);
  }

  async function handleCommunityPostSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = postDraft.trim();
    if (!period || !body || savingPost) return;

    const client = getSupabase();
    setSavingPost(true);
    setError(null);

    const { error: postError } = await client.from("thank_you_events").insert({
      period_id: period.id,
      kind: "community_post",
      message: body,
    });

    if (postError) {
      setError("全体投稿を登録できませんでした。");
    } else {
      setPostDraft("");
      await loadEvents(period.id);
    }

    setSavingPost(false);
  }

  async function handleCommentSubmit(
    event: React.FormEvent<HTMLFormElement>,
    eventId: string,
  ) {
    event.preventDefault();
    const body = (commentDrafts[eventId] ?? "").trim();
    if (!body || savingCommentId) return;

    const client = getSupabase();
    setSavingCommentId(eventId);
    setError(null);

    const { error: commentError } = await client
      .from("thank_you_comments")
      .insert({ event_id: eventId, body });

    if (commentError) {
      setError("コメントを登録できませんでした。");
    } else {
      setCommentDrafts((current) => ({ ...current, [eventId]: "" }));
      await loadInteractions(recentEventIds);
    }

    setSavingCommentId(null);
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
        <div className="hero-button-area">
          <button
            className="thank-you-button"
            disabled={!period || submitting}
            onClick={() => void handleThankYou()}
            type="button"
          >
            <Sparkles aria-hidden="true" />
            <span>{submitting ? "登録中..." : "ありがとうをいただきました"}</span>
          </button>
        </div>
        <div
          className="progress-ring"
          style={{ "--progress": `${progressDegrees}deg` } as React.CSSProperties}
          aria-label={`達成率 ${formatNumber(roundedProgress)} パーセント`}
        >
          <span>{formatNumber(roundedProgress)}%</span>
        </div>
        <div className="burst-layer" aria-hidden="true">
          {bursts.map((burst) => (
            <span
              key={burst.id}
              style={{ left: `${burst.left}%`, fontFamily: burst.fontFamily }}
            >
              ありがとう
            </span>
          ))}
        </div>
      </section>

      <section className="action-band">
        <p className="eyebrow">Object</p>
        <h2>
          一人でも多くの人の日常をアップデートすることで、「オーキ製薬に出会えてよかった」を溢れさせる
        </h2>
        <p>
          {profile?.display_name || user?.email || "あなた"}さんの今期カウント:
          <strong> {formatNumber(myCount)} </strong>件
        </p>
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
              ranking.map((entry) => (
                <li key={entry.userId}>
                  <span className={`rank-number rank-${entry.rank}`}>
                    {formatNumber(entry.rank)}
                  </span>
                  <ProfileAvatar
                    name={entry.name}
                    src={entry.avatarUrl}
                    avatarScale={entry.avatarScale}
                    size="sm"
                  />
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
          <form className="community-post-form" onSubmit={(event) => void handleCommunityPostSubmit(event)}>
            <div className="community-post-heading">
              <ProfileAvatar
                name={profile?.display_name || user?.email || "メンバー"}
                src={profile?.avatar_url}
                avatarScale={profile?.avatar_scale}
                size="sm"
              />
              <div>
                <strong>全体に投稿</strong>
                <span>みんなに届けるメッセージ</span>
              </div>
            </div>
            <textarea
              maxLength={500}
              onChange={(event) => setPostDraft(event.target.value)}
              placeholder="皆さん今日もありがとうございました"
              value={postDraft}
            />
            <div className="community-post-footer">
              <span>{formatNumber(postDraft.length)} / 500</span>
              <button className="button button-primary" disabled={!postDraft.trim() || savingPost} type="submit">
                <Send aria-hidden="true" />
                投稿する
              </button>
            </div>
          </form>
          <div className="timeline">
            {recentEvents.map((event) => (
              <div className="timeline-card" key={event.id}>
                <div className="timeline-row">
                  <ProfileAvatar
                    name={nameForEvent(event)}
                    src={event.profiles?.avatar_url}
                    avatarScale={event.profiles?.avatar_scale}
                    size="sm"
                  />
                  <div>
                    <strong>{nameForEvent(event)}</strong>
                    <p>
                      {event.kind === "community_post" ? "全体投稿 / " : ""}
                      {event.kind === "thank_you" && event.profiles?.company_name
                        ? `${event.profiles.company_name} / `
                        : ""}
                      {formatDateTime(event.created_at)}
                    </p>
                  </div>
                </div>
                {event.kind === "community_post" ? (
                  event.id === editingPostId ? (
                    <form
                      className="community-post-edit-form"
                      onSubmit={(formEvent) =>
                        void handleCommunityPostUpdate(formEvent, event.id)
                      }
                    >
                      <textarea
                        maxLength={500}
                        onChange={(inputEvent) => setEditPostDraft(inputEvent.target.value)}
                        value={editPostDraft}
                        autoFocus
                      />
                      <div className="community-post-edit-footer">
                        <span>{formatNumber(editPostDraft.length)} / 500</span>
                        <div>
                          <button
                            className="mini-action"
                            onClick={cancelEditingPost}
                            type="button"
                          >
                            <X aria-hidden="true" />
                            キャンセル
                          </button>
                          <button
                            className="mini-action mini-action-primary"
                            disabled={!editPostDraft.trim() || savingEditId === event.id}
                            type="submit"
                          >
                            <Check aria-hidden="true" />
                            {savingEditId === event.id ? "保存中..." : "保存"}
                          </button>
                        </div>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="community-post-body">{event.message}</p>
                      {event.user_id === user?.id ? (
                        <div className="community-post-actions">
                          <button
                            className="mini-action"
                            onClick={() => startEditingPost(event)}
                            type="button"
                          >
                            <Pencil aria-hidden="true" />
                            編集
                          </button>
                          <button
                            className="mini-action mini-action-danger"
                            disabled={deletingPostId === event.id}
                            onClick={() => void handleCommunityPostDelete(event)}
                            type="button"
                          >
                            <Trash2 aria-hidden="true" />
                            {deletingPostId === event.id ? "削除中..." : "削除"}
                          </button>
                        </div>
                      ) : null}
                    </>
                  )
                ) : null}
                <div className="interaction-row">
                  <div
                    className={`reaction-action-wrap ${
                      reactionPickerId === event.id ? "is-open" : ""
                    }`}
                  >
                    <button
                      aria-label="リアクションを選択"
                      aria-expanded={reactionPickerId === event.id}
                      aria-haspopup="true"
                      className={`mini-action ${
                        likesByEvent[event.id]?.reactionByMe.length ? "active" : ""
                      }`}
                      onClick={() =>
                        setReactionPickerId((current) =>
                          current === event.id ? null : event.id,
                        )
                      }
                      title="リアクションを選択"
                      type="button"
                    >
                      <span className="reaction-current">
                        {REACTION_OPTIONS.find(
                          (option) =>
                            likesByEvent[event.id]?.reactionByMe.includes(option.key),
                        )?.emoji ?? <ThumbsUp aria-hidden="true" />}
                      </span>
                      {formatNumber(likesByEvent[event.id]?.count ?? 0)}
                    </button>
                    {reactionPickerId === event.id ? (
                      <div className="reaction-picker" role="group" aria-label="リアクションを選択">
                        {REACTION_OPTIONS.map((option) => (
                          <button
                            aria-label={option.label}
                            className={
                              likesByEvent[event.id]?.reactionByMe.includes(option.key)
                                ? "active"
                                : ""
                            }
                            key={option.key}
                            onClick={() => void toggleReaction(event.id, option.key)}
                            title={option.label}
                            type="button"
                          >
                            {option.emoji}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="reaction-summary-list" aria-label="リアクションの内訳">
                    {REACTION_OPTIONS.filter(
                      (option) =>
                        (likesByEvent[event.id]?.reactionCounts[option.key] ?? 0) > 0,
                    ).map((option) => {
                      const peopleKey = `${event.id}:${option.key}`;
                      const people =
                        likesByEvent[event.id]?.reactionUsers[option.key] ?? [];
                      return (
                        <div
                          className={`reaction-summary-wrap ${
                            reactionPeopleKey === peopleKey ? "is-open" : ""
                          }`}
                          key={option.key}
                        >
                          <button
                            aria-expanded={reactionPeopleKey === peopleKey}
                            aria-label={`${option.label}を押した人を見る`}
                            className={`reaction-summary-button ${
                              reactionPeopleKey === peopleKey ? "active" : ""
                            }`}
                            onClick={() =>
                              setReactionPeopleKey((current) =>
                                current === peopleKey ? null : peopleKey,
                              )
                            }
                            title={`${option.label}を押した人を見る`}
                            type="button"
                          >
                            <span>{option.emoji}</span>
                            {formatNumber(likesByEvent[event.id]?.reactionCounts[option.key] ?? 0)}
                          </button>
                          <div className="reaction-people-popover" role="tooltip">
                            <strong>
                              {option.emoji} {option.label}を押した人
                            </strong>
                            <div className="reaction-people-list">
                              {people.map((person, index) => {
                                const personName =
                                  person.display_name || person.email || "メンバー";
                                return (
                                  <div
                                    className="reaction-person"
                                    key={`${person.email ?? personName}-${index}`}
                                  >
                                    <ProfileAvatar
                                      name={personName}
                                      src={person.avatar_url}
                                      avatarScale={person.avatar_scale}
                                      size="sm"
                                    />
                                    <span>{personName}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <span>
                    <MessageCircle aria-hidden="true" />
                    {formatNumber(commentsByEvent[event.id]?.length ?? 0)}
                  </span>
                </div>
                <div className="comment-list">
                  {(commentsByEvent[event.id] ?? []).map((comment) => {
                    const commenter =
                      comment.profiles?.display_name ||
                      comment.profiles?.email ||
                      "メンバー";
                    return (
                      <div className="comment-row" key={comment.id}>
                        <ProfileAvatar
                          name={commenter}
                          src={comment.profiles?.avatar_url}
                          avatarScale={comment.profiles?.avatar_scale}
                          size="sm"
                        />
                        <div>
                          <strong>{commenter}</strong>
                          <p>{comment.body}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <form
                  className="comment-form"
                  onSubmit={(formEvent) => void handleCommentSubmit(formEvent, event.id)}
                >
                  <input
                    maxLength={500}
                    onChange={(inputEvent) =>
                      setCommentDrafts((current) => ({
                        ...current,
                        [event.id]: inputEvent.target.value,
                      }))
                    }
                    placeholder="コメントを書く"
                    value={commentDrafts[event.id] ?? ""}
                  />
                  <button
                    className="icon-button"
                    disabled={savingCommentId === event.id}
                    type="submit"
                    aria-label="コメントを送信"
                    title="コメントを送信"
                  >
                    <Send aria-hidden="true" />
                  </button>
                </form>
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
