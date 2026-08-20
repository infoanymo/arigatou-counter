import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Calculator,
  CreditCard,
  ExternalLink,
  KeyRound,
  MailPlus,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCcw,
  Send,
  Trash2,
  TriangleAlert,
  UserRound,
  UserCog,
} from "lucide-react";
import type {
  Period,
  Profile,
  ProfileStatus,
  ThankYouAdjustment,
  ThankYouEvent,
} from "../lib/database.types";
import { formatDateTime, formatNumber } from "../lib/format";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { ProfileAvatar } from "../components/ProfileAvatar";

type AdminUser = {
  id: string;
  email: string;
  displayName: string | null;
  companyName: string | null;
  avatarUrl: string | null;
  avatarScale: number;
  role: "admin" | "member";
  status: ProfileStatus;
  createdAt: string;
  lastSignInAt: string | null;
};

type PeriodForm = {
  id: string | null;
  name: string;
  starts_on: string;
  ends_on: string;
  target_count: string;
};

type AdjustmentWithProfile = ThankYouAdjustment & {
  profiles: Pick<Profile, "display_name" | "email" | "avatar_url" | "avatar_scale"> | null;
};

type ThankYouEventWithProfile = ThankYouEvent & {
  profiles: Pick<
    Profile,
    "display_name" | "email" | "company_name" | "avatar_url" | "avatar_scale"
  > | null;
};

type EventInteractionCounts = {
  likes: number;
  comments: number;
};

type AdminSection = "account" | "adjustment" | "billing" | "chatwork";

type BillingPrice = {
  amount?: number;
  description?: string;
  interval?: string;
  type?: string;
};

type BillingAddon = {
  type: string;
  variantId: string;
  name: string;
  price: BillingPrice | null;
  estimatedMonthlyUsd: number;
};

type BillingUsage = {
  live: boolean;
  generatedAt: string;
  message?: string;
  missing?: string[];
  project?: {
    ref: string;
    name: string;
    region: string;
    status: string;
    organizationSlug: string;
  };
  organization?: {
    name: string;
    slug: string;
    plan: "free" | "pro" | "team" | "enterprise" | "platform";
  } | null;
  billingPageUrl?: string;
  usagePageUrl?: string;
  selectedAddons?: BillingAddon[];
  selectedAddonEstimatedMonthlyUsd?: number;
  apiRequestCount?: number | null;
  apiCounts?: {
    timestamp: string;
    total_auth_requests: number;
    total_realtime_requests: number;
    total_rest_requests: number;
    total_storage_requests: number;
  }[];
  warnings?: string[];
};

type ChatworkSettings = {
  enabled: boolean;
  roomId: string;
  rooms: ChatworkRoomSettings[];
  tokenConfigured: boolean;
  updatedAt: string | null;
  goodVoiceEnabled: boolean;
  goodVoiceKeywords: string[];
  goodVoiceRooms: ChatworkRoomSettings[];
};

type ChatworkRoomSettings = {
  id: string;
  name: string;
  roomId: string;
  messageTemplate: string;
  enabled: boolean;
};

type ChatworkMessagePreview = {
  roomId: string;
  roomName: string;
  message: string;
};

type ChatworkPreview = {
  targetMonth: string;
  targetMonthLabel: string;
  startIso: string;
  endIso: string;
  cumulativeTotal: number;
  monthlyTotal: number;
  message: string;
  messages: ChatworkMessagePreview[];
};

type ChatworkNotification = {
  target_month: string;
  room_id: string | null;
  room_name: string | null;
  status: "sent" | "failed";
  cumulative_count: number | null;
  monthly_count: number | null;
  error_message: string | null;
  sent_at: string | null;
  triggered_by: "admin" | "cron" | null;
};

type ChatworkSettingsResponse = {
  settings: ChatworkSettings;
  preview: ChatworkPreview;
  lastNotification: ChatworkNotification | null;
  lastNotifications?: ChatworkNotification[];
  manualGoodVoices?: ManualGoodVoice[];
};

type ManualGoodVoice = {
  id: string;
  chatwork_message_id: string | null;
  room_id: string;
  room_name: string | null;
  author_name: string | null;
  message_body: string;
  sent_at: string;
  created_at: string;
};

const planLabels = {
  free: "Free",
  pro: "Pro",
  team: "Team",
  enterprise: "Enterprise",
  platform: "Platform",
} as const;

const usdToJpyRate = 158;
const today = new Date().toISOString().slice(0, 10);
const defaultChatworkMessageTemplate = `[toall]
[info][title]内容：ありがとう集計[/title]
担当部署：CS/CX
【通知内容】
累計ありがとう：{{cumulativeTotal}}
{{targetMonth}}のありがとう：{{monthlyTotal}}[/info]`;

function chatworkRoomLocalId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createChatworkRoom(
  overrides: Partial<ChatworkRoomSettings> = {},
): ChatworkRoomSettings {
  return {
    id: overrides.id ?? chatworkRoomLocalId(),
    name: overrides.name ?? "",
    roomId: overrides.roomId ?? "",
    messageTemplate: overrides.messageTemplate ?? defaultChatworkMessageTemplate,
    enabled: overrides.enabled ?? true,
  };
}

function normalizeChatworkRooms(rooms: ChatworkRoomSettings[] | undefined) {
  return rooms?.length
    ? rooms.map((room) =>
        createChatworkRoom({
          ...room,
          messageTemplate: room.messageTemplate || defaultChatworkMessageTemplate,
        }),
      )
    : [createChatworkRoom()];
}

function parseIntegerInput(value: string) {
  return Number(value.replace(/,/g, ""));
}

function formatIntegerInput(value: string, signed = false) {
  const trimmed = value.trim();
  const sign = signed && /^[+-]/.test(trimmed) ? trimmed[0] : "";
  const digits = trimmed.replace(/\D/g, "");

  if (!digits) return sign;
  return `${sign}${formatNumber(Number(digits))}`;
}

function formatYenFromUsd(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "個別見積";
  return new Intl.NumberFormat("ja-JP", {
    currency: "JPY",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(Math.round(value * usdToJpyRate));
}

function formatBillingDate(value: string | null | undefined) {
  if (!value) return "未取得";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMonthDate(value: string | null | undefined) {
  if (!value) return "未送信";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

function thankYouEventUserName(event: ThankYouEventWithProfile | null) {
  return event?.profiles?.display_name || event?.profiles?.email || "メンバー";
}

function shortEventId(value: string) {
  return value.slice(0, 8);
}

function localDateTimeToIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function billingApiBreakdown(usage: BillingUsage | null) {
  const latest = usage?.apiCounts?.at(-1);
  if (!latest) {
    return {
      auth: 0,
      realtime: 0,
      rest: 0,
      storage: 0,
    };
  }

  return {
    auth: latest.total_auth_requests,
    realtime: latest.total_realtime_requests,
    rest: latest.total_rest_requests,
    storage: latest.total_storage_requests,
  };
}

function defaultPeriodForm(): PeriodForm {
  const end = new Date();
  end.setMonth(end.getMonth() + 3);

  return {
    id: null,
    name: "今期",
    starts_on: today,
    ends_on: end.toISOString().slice(0, 10),
    target_count: formatNumber(1000),
  };
}

function formFromPeriod(period: Period | null): PeriodForm {
  if (!period) return defaultPeriodForm();
  return {
    id: period.id,
    name: period.name,
    starts_on: period.starts_on,
    ends_on: period.ends_on,
    target_count: formatNumber(period.target_count),
  };
}

async function invokeAdmin<T>(
  body: Record<string, unknown>,
): Promise<T> {
  const client = getSupabase();
  const { data, error } = await client.functions.invoke<T>("admin-users", {
    body,
  });

  if (error) {
    throw new Error(await functionErrorMessage(error));
  }

  return data as T;
}

async function functionErrorMessage(error: unknown) {
  const fallback =
    error instanceof Error ? error.message : "処理を完了できませんでした。";
  const context = (error as { context?: unknown })?.context;

  if (context instanceof Response) {
    const text = await context.text().catch(() => "");
    if (!text) return fallback;

    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
      const message = parsed.error ?? parsed.message;
      return typeof message === "string" && message.trim()
        ? message
        : fallback;
    } catch {
      return text.trim() || fallback;
    }
  }

  return fallback;
}

async function invokeBilling(): Promise<BillingUsage> {
  const client = getSupabase();
  const { data, error } = await client.functions.invoke<BillingUsage>(
    "billing-usage",
    {
      body: { action: "summary" },
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  return data as BillingUsage;
}

async function invokeChatwork<T>(body: Record<string, unknown>): Promise<T> {
  const client = getSupabase();
  const { data, error } = await client.functions.invoke<T>(
    "chatwork-notification",
    {
      body,
    },
  );

  if (error) {
    throw new Error(await functionErrorMessage(error));
  }

  return data as T;
}

export function AdminPage({ section }: { section: AdminSection }) {
  const { user, refreshAuth } = useAuth();
  const [periodForm, setPeriodForm] = useState<PeriodForm>(defaultPeriodForm);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentWithProfile[]>([]);
  const [thankYouEvents, setThankYouEvents] = useState<ThankYouEventWithProfile[]>(
    [],
  );
  const [eventInteractionCounts, setEventInteractionCounts] = useState<
    Record<string, EventInteractionCounts>
  >({});
  const [eventCount, setEventCount] = useState(0);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountRole, setAccountRole] = useState<"member" | "admin">("member");
  const [adjustmentDelta, setAdjustmentDelta] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [thankYouStartFilter, setThankYouStartFilter] = useState("");
  const [thankYouEndFilter, setThankYouEndFilter] = useState("");
  const [thankYouKeywordFilter, setThankYouKeywordFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingThankYouEvents, setLoadingThankYouEvents] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [clearingThankYous, setClearingThankYous] = useState(false);
  const [thankYouEventToDelete, setThankYouEventToDelete] =
    useState<ThankYouEventWithProfile | null>(null);
  const [deletingThankYouEventId, setDeletingThankYouEventId] = useState<
    string | null
  >(null);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [billingUsage, setBillingUsage] = useState<BillingUsage | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [chatworkSettings, setChatworkSettings] =
    useState<ChatworkSettings | null>(null);
  const [chatworkPreview, setChatworkPreview] =
    useState<ChatworkPreview | null>(null);
  const [chatworkLastNotifications, setChatworkLastNotifications] = useState<
    ChatworkNotification[]
  >([]);
  const [chatworkApiToken, setChatworkApiToken] = useState("");
  const [chatworkRooms, setChatworkRooms] = useState<ChatworkRoomSettings[]>(() => [
    createChatworkRoom(),
  ]);
  const [goodVoiceRooms, setGoodVoiceRooms] = useState<ChatworkRoomSettings[]>(() => [
    createChatworkRoom(),
  ]);
  const [chatworkEnabled, setChatworkEnabled] = useState(false);
  const [goodVoiceEnabled, setGoodVoiceEnabled] = useState(false);
  const [goodVoiceKeywords, setGoodVoiceKeywords] = useState("お客様,お声,見えるようになりました,よく見える,改善");
  const [manualGoodVoiceBody, setManualGoodVoiceBody] = useState("");
  const [manualGoodVoiceAuthor, setManualGoodVoiceAuthor] = useState("");
  const [manualGoodVoiceDate, setManualGoodVoiceDate] = useState(today);
  const [addingManualGoodVoice, setAddingManualGoodVoice] = useState(false);
  const [manualGoodVoices, setManualGoodVoices] = useState<ManualGoodVoice[]>([]);
  const [manualGoodVoiceToDelete, setManualGoodVoiceToDelete] =
    useState<ManualGoodVoice | null>(null);
  const [deletingManualGoodVoiceId, setDeletingManualGoodVoiceId] = useState<
    string | null
  >(null);
  const [savingChatwork, setSavingChatwork] = useState(false);
  const [sendingChatwork, setSendingChatwork] = useState<"test" | "monthly" | null>(
    null,
  );

  const adjustmentTotal = useMemo(
    () => adjustments.reduce((sum, item) => sum + item.delta, 0),
    [adjustments],
  );
  const adjustedTotal = Math.max(0, eventCount + adjustmentTotal);

  const sortedUsers = useMemo(
    () =>
      [...users].sort((a, b) => {
        if (a.status !== b.status) return a.status === "active" ? -1 : 1;
        if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
        return a.email.localeCompare(b.email);
      }),
    [users],
  );

  const filteredThankYouEvents = useMemo(() => {
    const keyword = thankYouKeywordFilter.trim().toLocaleLowerCase("ja-JP");
    if (!keyword) return thankYouEvents;

    return thankYouEvents.filter((event) => {
      const searchable = [
        thankYouEventUserName(event),
        event.profiles?.email,
        event.profiles?.company_name,
        event.id,
        formatDateTime(event.created_at),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ja-JP");

      return searchable.includes(keyword);
    });
  }, [thankYouEvents, thankYouKeywordFilter]);

  const loadThankYouEventList = useCallback(
    async (periodId: string) => {
      const client = getSupabase();
      setLoadingThankYouEvents(true);

      let query = client
        .from("thank_you_events")
        .select(
          "id, period_id, user_id, kind, message, created_at, profiles:profiles!thank_you_events_user_id_fkey(display_name,email,company_name,avatar_url,avatar_scale)",
        )
        .eq("period_id", periodId)
        .order("created_at", { ascending: false })
        .limit(500);

      const startIso = localDateTimeToIso(thankYouStartFilter);
      const endIso = localDateTimeToIso(thankYouEndFilter);

      if (startIso) query = query.gte("created_at", startIso);
      if (endIso) query = query.lte("created_at", endIso);

      const { data, error } = await query.returns<ThankYouEventWithProfile[]>();

      if (error) {
        setMessage("個別削除用のありがとう一覧を読み込めませんでした。");
        setThankYouEvents([]);
        setEventInteractionCounts({});
        setLoadingThankYouEvents(false);
        return;
      }

      const events = data ?? [];
      const eventIds = events.map((event) => event.id);
      const counts = Object.fromEntries(
        eventIds.map((eventId) => [eventId, { likes: 0, comments: 0 }]),
      ) as Record<string, EventInteractionCounts>;

      if (eventIds.length) {
        const [likesResult, commentsResult] = await Promise.all([
          client
            .from("thank_you_likes")
            .select("event_id")
            .in("event_id", eventIds)
            .returns<Array<{ event_id: string }>>(),
          client
            .from("thank_you_comments")
            .select("event_id")
            .in("event_id", eventIds)
            .returns<Array<{ event_id: string }>>(),
        ]);

        if (likesResult.error || commentsResult.error) {
          setMessage("ありがとうの反応数を一部読み込めませんでした。");
        }

        for (const like of likesResult.data ?? []) {
          if (counts[like.event_id]) counts[like.event_id].likes += 1;
        }

        for (const comment of commentsResult.data ?? []) {
          if (counts[comment.event_id]) counts[comment.event_id].comments += 1;
        }
      }

      setThankYouEvents(events);
      setEventInteractionCounts(counts);
      setLoadingThankYouEvents(false);
    },
    [thankYouEndFilter, thankYouStartFilter],
  );

  const loadAdjustmentSummary = useCallback(async (periodId: string) => {
    const client = getSupabase();

    const { count, error: countError } = await client
      .from("thank_you_events")
      .select("*", { count: "exact", head: true })
      .eq("period_id", periodId)
      .eq("kind", "thank_you");

    if (countError) {
      setMessage("ありがとう件数を読み込めませんでした。");
      setEventCount(0);
    } else {
      setEventCount(count ?? 0);
    }

    const { data, error: adjustmentsError } = await client
      .from("thank_you_adjustments")
      .select(
        "id, period_id, admin_user_id, delta, reason, created_at, profiles:profiles!thank_you_adjustments_admin_user_id_fkey(display_name,email,avatar_url,avatar_scale)",
      )
      .eq("period_id", periodId)
      .order("created_at", { ascending: false })
      .limit(30)
      .returns<AdjustmentWithProfile[]>();

    if (adjustmentsError) {
      setMessage("補正履歴を読み込めませんでした。");
      setAdjustments([]);
      return;
    }

    setAdjustments(data ?? []);
  }, []);

  const loadAdmin = useCallback(async () => {
    const client = getSupabase();
    setLoading(true);
    setMessage(null);

    const { data: period, error: periodError } = await client
      .from("periods")
      .select("*")
      .eq("is_active", true)
      .order("starts_on", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (periodError) {
      setMessage("期設定を読み込めませんでした。");
      setAdjustments([]);
      setThankYouEvents([]);
      setEventInteractionCounts({});
      setEventCount(0);
    } else {
      setPeriodForm(formFromPeriod(period));
      if (period) {
        await loadAdjustmentSummary(period.id);
      } else {
        setAdjustments([]);
        setThankYouEvents([]);
        setEventInteractionCounts({});
        setEventCount(0);
      }
    }

    try {
      const response = await invokeAdmin<{ users: AdminUser[] }>({
        action: "list",
      });
      setUsers(response.users);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ユーザー一覧を読み込めませんでした。",
      );
    } finally {
      setLoading(false);
    }
  }, [loadAdjustmentSummary]);

  const loadBilling = useCallback(async () => {
    setBillingLoading(true);
    try {
      setBillingUsage(await invokeBilling());
    } catch (error) {
      setBillingUsage({
        live: false,
        generatedAt: new Date().toISOString(),
        message:
          error instanceof Error
            ? error.message
            : "利用料情報を取得できませんでした。",
      });
    } finally {
      setBillingLoading(false);
    }
  }, []);

  const loadChatwork = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      const response = await invokeChatwork<ChatworkSettingsResponse>({
        action: "get-settings",
      });

      setChatworkSettings(response.settings);
      setChatworkPreview(response.preview);
      setChatworkLastNotifications(
        response.lastNotifications ??
          (response.lastNotification ? [response.lastNotification] : []),
      );
      setChatworkRooms(normalizeChatworkRooms(response.settings.rooms));
      setGoodVoiceRooms(normalizeChatworkRooms(response.settings.goodVoiceRooms));
      setChatworkEnabled(response.settings.enabled);
      setGoodVoiceEnabled(response.settings.goodVoiceEnabled);
      setGoodVoiceKeywords(response.settings.goodVoiceKeywords.join(","));
      setManualGoodVoices(response.manualGoodVoices ?? []);
      setChatworkApiToken("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "チャットワーク連携を読み込めませんでした。",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (section === "billing") {
      setLoading(false);
      void loadBilling();
      return;
    }

    if (section === "chatwork") {
      void loadChatwork();
      return;
    }

    void loadAdmin();
  }, [loadAdmin, loadBilling, loadChatwork, section]);

  useEffect(() => {
    if (section !== "adjustment" || !periodForm.id) return;
    void loadThankYouEventList(periodForm.id);
  }, [loadThankYouEventList, periodForm.id, section]);

  async function handleCreateAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingAccount(true);
    setMessage(null);

    try {
      await invokeAdmin({
        action: "invite",
        email: accountEmail.trim(),
        role: accountRole,
      });
      setAccountEmail("");
      setAccountRole("member");
      setMessage("招待メールを送信しました。");
      await loadAdmin();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "招待メールを送信できませんでした。",
      );
    } finally {
      setCreatingAccount(false);
    }
  }

  async function handleAdjustmentSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!periodForm.id) {
      setMessage("先に期設定を保存してください。");
      return;
    }

    const delta = parseIntegerInput(adjustmentDelta);
    if (!Number.isInteger(delta) || delta === 0) {
      setMessage("補正数は0以外の整数で入力してください。");
      return;
    }

    setSavingAdjustment(true);
    setMessage(null);

    try {
      await invokeAdmin({
        action: "adjust-thank-you",
        periodId: periodForm.id,
        delta,
        reason: adjustmentReason.trim() || null,
      });
      setAdjustmentDelta("");
      setAdjustmentReason("");
      setMessage("ありがとう件数を補正しました。");
      await loadAdjustmentSummary(periodForm.id);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "補正を登録できませんでした。管理者権限を確認してください。",
      );
    }

    setSavingAdjustment(false);
  }

  async function handleClearThankYous() {
    if (!periodForm.id || clearingThankYous) return;

    setClearingThankYous(true);
    setMessage(null);

    try {
      await invokeAdmin({
        action: "clear-thank-yous",
        periodId: periodForm.id,
      });
      setMessage("今期のありがとうをすべて削除しました。");
      setShowClearDialog(false);
      await loadAdmin();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ありがとうを削除できませんでした。",
      );
    } finally {
      setClearingThankYous(false);
    }
  }

  async function handleDeleteThankYouEvent() {
    if (!periodForm.id || !thankYouEventToDelete) return;

    setDeletingThankYouEventId(thankYouEventToDelete.id);
    setMessage(null);

    try {
      await invokeAdmin({
        action: "delete-thank-you-event",
        periodId: periodForm.id,
        eventId: thankYouEventToDelete.id,
      });
      setMessage("選択したありがとうを削除しました。");
      setThankYouEventToDelete(null);
      await Promise.all([
        loadAdjustmentSummary(periodForm.id),
        loadThankYouEventList(periodForm.id),
      ]);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "選択したありがとうを削除できませんでした。",
      );
    } finally {
      setDeletingThankYouEventId(null);
    }
  }

  async function updateUser(
    targetUser: AdminUser,
    action: "set-role" | "set-status",
    value: string,
  ) {
    setMessage(null);
    try {
      await invokeAdmin({
        action,
        userId: targetUser.id,
        value,
      });
      setMessage("ユーザー設定を更新しました。");
      await loadAdmin();
      if (targetUser.id === user?.id) await refreshAuth();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "ユーザー設定を更新できませんでした。",
      );
    }
  }

  function updateChatworkRoom(
    roomId: string,
    updates: Partial<ChatworkRoomSettings>,
  ) {
    setChatworkRooms((current) =>
      current.map((room) => (room.id === roomId ? { ...room, ...updates } : room)),
    );
  }

  function addChatworkRoom() {
    setChatworkRooms((current) => [...current, createChatworkRoom()]);
  }

  function removeChatworkRoom(roomId: string) {
    setChatworkRooms((current) =>
      current.length > 1 ? current.filter((room) => room.id !== roomId) : current,
    );
  }

  function updateGoodVoiceRoom(roomId: string, updates: Partial<ChatworkRoomSettings>) {
    setGoodVoiceRooms((current) =>
      current.map((room) => (room.id === roomId ? { ...room, ...updates } : room)),
    );
  }

  function addGoodVoiceRoom() {
    setGoodVoiceRooms((current) => [...current, createChatworkRoom()]);
  }

  function removeGoodVoiceRoom(roomId: string) {
    setGoodVoiceRooms((current) =>
      current.length > 1 ? current.filter((room) => room.id !== roomId) : current,
    );
  }

  async function handleChatworkSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingChatwork(true);
    setMessage(null);

    try {
      await invokeChatwork({
        action: "save-settings",
        apiToken: chatworkApiToken.trim(),
        rooms: chatworkRooms.map((room) => ({
          id: room.id,
          name: room.name.trim(),
          roomId: room.roomId.trim(),
          messageTemplate: room.messageTemplate,
          enabled: room.enabled,
        })),
        enabled: chatworkEnabled,
        goodVoiceRooms: goodVoiceRooms.map((room) => ({
          id: room.id,
          name: room.name.trim(),
          roomId: room.roomId.trim(),
          enabled: room.enabled,
        })),
        goodVoiceEnabled,
        goodVoiceKeywords: goodVoiceKeywords.split(",").map((keyword) => keyword.trim()).filter(Boolean),
      });
      setMessage("チャットワーク連携を保存しました。");
      await loadChatwork();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "チャットワーク連携を保存できませんでした。",
      );
    } finally {
      setSavingChatwork(false);
    }
  }

  async function handleAddManualGoodVoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualGoodVoiceBody.trim()) return;
    setAddingManualGoodVoice(true);
    setMessage(null);

    try {
      await invokeChatwork({
        action: "add-manual-good-voice",
        messageBody: manualGoodVoiceBody.trim(),
        authorName: manualGoodVoiceAuthor.trim(),
        sentAt: manualGoodVoiceDate,
      });
      setManualGoodVoiceBody("");
      setManualGoodVoiceAuthor("");
      setManualGoodVoiceDate(today);
      setMessage("いいお声を追加しました。");
      await loadChatwork();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "いいお声を追加できませんでした。");
    } finally {
      setAddingManualGoodVoice(false);
    }
  }

  async function handleDeleteManualGoodVoice() {
    if (!manualGoodVoiceToDelete || deletingManualGoodVoiceId) return;
    const target = manualGoodVoiceToDelete;
    setDeletingManualGoodVoiceId(target.id);
    setMessage(null);

    try {
      await invokeChatwork({
        action: "delete-manual-good-voice",
        id: target.id,
      });
      setManualGoodVoices((voices) => voices.filter((voice) => voice.id !== target.id));
      setManualGoodVoiceToDelete(null);
      setMessage("いいお声を削除しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "いいお声を削除できませんでした。");
    } finally {
      setDeletingManualGoodVoiceId(null);
    }
  }

  async function sendChatwork(action: "send-test" | "send-monthly") {
    setSendingChatwork(action === "send-test" ? "test" : "monthly");
    setMessage(null);

    try {
      const response = await invokeChatwork<{
        skipped?: boolean;
        reason?: string;
      }>({
        action,
      });

      if (response.skipped && response.reason === "already_sent") {
        setMessage("この月の通知はすでに送信済みです。");
      } else {
        setMessage(
          action === "send-test"
            ? "チャットワークへテスト送信しました。"
            : "チャットワークへ月次通知を送信しました。",
        );
      }

      await loadChatwork();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "チャットワークへ送信できませんでした。",
      );
    } finally {
      setSendingChatwork(null);
    }
  }

  const sectionTitle =
    section === "account"
      ? "アカウント"
      : section === "adjustment"
        ? "件数調整"
        : section === "chatwork"
          ? "チャットワーク連携"
          : "料金";
  const sectionDescription =
    section === "account"
      ? "招待メールの送信とユーザー権限を管理します。"
      : section === "adjustment"
        ? "ありがとう件数の補正と全削除を管理します。"
        : section === "chatwork"
          ? "月初3日にありがとう集計をチャットワークへ送信します。"
          : "このアプリの運営にかかる利用料の目安を確認します。";
  const billingBreakdown = billingApiBreakdown(billingUsage);
  const billingAddedCost = billingUsage?.selectedAddonEstimatedMonthlyUsd ?? null;
  const billingPlanLabel = billingUsage?.organization?.plan
    ? planLabels[billingUsage.organization.plan]
    : "未取得";
  const configuredChatworkRooms =
    chatworkSettings?.rooms.filter((room) => room.enabled && room.roomId.trim()) ??
    [];
  const canSendChatwork = Boolean(
    chatworkSettings?.enabled &&
      chatworkSettings?.tokenConfigured &&
      configuredChatworkRooms.length,
  );
  const chatworkPreviewMessages =
    chatworkPreview?.messages?.length
      ? chatworkPreview.messages
      : chatworkPreview
        ? [
            {
              roomId: chatworkSettings?.roomId ?? "",
              roomName: "送信プレビュー",
              message: chatworkPreview.message,
            },
          ]
        : [];

  return (
    <div className="admin-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>{sectionTitle}</h1>
          <p>{sectionDescription}</p>
        </div>
        <button
          className="button button-secondary"
          disabled={section === "billing" ? billingLoading : loading}
          onClick={() =>
            section === "billing"
              ? void loadBilling()
              : section === "chatwork"
                ? void loadChatwork()
                : void loadAdmin()
          }
        >
          <RefreshCcw aria-hidden="true" />
          {section === "billing" && billingLoading ? "取得中..." : "更新"}
        </button>
      </header>

      {message ? <p className="notice">{message}</p> : null}

      <nav className="admin-tabs" aria-label="管理メニュー">
        <NavLink to="/admin/account">
          <UserCog aria-hidden="true" />
          アカウント
        </NavLink>
        <NavLink to="/admin/adjustment">
          <Calculator aria-hidden="true" />
          件数調整
        </NavLink>
        <NavLink to="/admin/chatwork">
          <MessageCircle aria-hidden="true" />
          チャットワーク連携
        </NavLink>
        <NavLink to="/admin/billing">
          <CreditCard aria-hidden="true" />
          料金
        </NavLink>
      </nav>

      {section === "account" ? (
        <>
          <section className="admin-grid single-column">
            <article className="panel">
              <div className="panel-title">
                <UserRound aria-hidden="true" />
                <div>
                  <p className="eyebrow">Account</p>
                  <h2>招待メール送信</h2>
                </div>
              </div>
              <form className="form-stack" onSubmit={handleCreateAccount}>
                <label>
                  <span>メールアドレス</span>
                  <input
                    autoComplete="email"
                    inputMode="email"
                    onChange={(event) => setAccountEmail(event.target.value)}
                    required
                    type="email"
                    value={accountEmail}
                  />
                </label>
                <label>
                  <span>権限</span>
                  <select
                    onChange={(event) =>
                      setAccountRole(event.target.value as "member" | "admin")
                    }
                    value={accountRole}
                  >
                    <option value="member">メンバー</option>
                    <option value="admin">管理者</option>
                  </select>
                </label>
                <button className="button button-primary" disabled={creatingAccount}>
                  <MailPlus aria-hidden="true" />
                  {creatingAccount ? "送信中..." : "招待メールを送信"}
                </button>
              </form>
            </article>
          </section>

          <section className="panel users-panel">
            <div className="panel-title">
              <UserCog aria-hidden="true" />
              <div>
                <p className="eyebrow">Users</p>
                <h2>ユーザー管理</h2>
              </div>
            </div>
            {loading ? (
              <p className="muted">読み込み中...</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ユーザー</th>
                      <th>権限</th>
                      <th>状態</th>
                      <th>最終ログイン</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedUsers.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className="user-cell">
                            <ProfileAvatar
                              name={item.displayName || item.email}
                              src={item.avatarUrl}
                              avatarScale={item.avatarScale}
                            />
                            <div>
                              <strong>{item.displayName || item.email}</strong>
                              <span>{item.email}</span>
                              {item.companyName ? <span>{item.companyName}</span> : null}
                            </div>
                          </div>
                        </td>
                        <td>
                          <select
                            disabled={item.id === user?.id}
                            onChange={(event) =>
                              void updateUser(item, "set-role", event.target.value)
                            }
                            value={item.role}
                          >
                            <option value="member">メンバー</option>
                            <option value="admin">管理者</option>
                          </select>
                        </td>
                        <td>
                          <select
                            disabled={item.id === user?.id}
                            onChange={(event) =>
                              void updateUser(item, "set-status", event.target.value)
                            }
                            value={item.status}
                          >
                            <option value="active">有効</option>
                            <option value="disabled">停止</option>
                          </select>
                        </td>
                        <td>
                          {item.lastSignInAt
                            ? formatDateTime(item.lastSignInAt)
                            : "未ログイン"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : section === "adjustment" ? (
        <section className="admin-grid single-column">
          <article className="panel">
            <div className="panel-title">
              <Calculator aria-hidden="true" />
              <div>
                <p className="eyebrow">Adjustment</p>
                <h2>ありがとう件数調整</h2>
              </div>
            </div>
          <div className="adjustment-summary" aria-label="ありがとう件数の内訳">
            <div>
              <span>押下数</span>
              <strong>{formatNumber(eventCount)}</strong>
            </div>
            <div>
              <span>補正</span>
              <strong>
                {adjustmentTotal > 0 ? "+" : ""}
                {formatNumber(adjustmentTotal)}
              </strong>
            </div>
            <div>
              <span>表示総数</span>
              <strong>{formatNumber(adjustedTotal)}</strong>
            </div>
          </div>
          <form className="form-stack" onSubmit={handleAdjustmentSave}>
            <label>
              <span>補正数</span>
              <input
                inputMode="numeric"
                onChange={(event) => setAdjustmentDelta(event.target.value)}
                onBlur={() =>
                  setAdjustmentDelta((current) => formatIntegerInput(current, true))
                }
                placeholder="+1,000 / -300"
                required
                type="text"
                value={adjustmentDelta}
              />
            </label>
            <label>
              <span>理由</span>
              <input
                onChange={(event) => setAdjustmentReason(event.target.value)}
                placeholder="入力漏れ分など"
                value={adjustmentReason}
              />
            </label>
            <button
              className="button button-primary"
              disabled={savingAdjustment || !periodForm.id}
            >
              <Calculator aria-hidden="true" />
              {savingAdjustment ? "登録中..." : "補正を登録"}
            </button>
          </form>
          <section className="thank-you-delete-panel">
            <div className="subsection-heading">
              <div>
                <p className="eyebrow">Delete</p>
                <h3>個別ありがとう削除</h3>
              </div>
              <button
                className="button button-secondary"
                disabled={loadingThankYouEvents || !periodForm.id}
                onClick={() =>
                  periodForm.id
                    ? void loadThankYouEventList(periodForm.id)
                    : undefined
                }
                type="button"
              >
                <RefreshCcw aria-hidden="true" />
                更新
              </button>
            </div>
            <div className="thank-you-delete-controls">
              <label>
                <span>開始日時</span>
                <input
                  onChange={(event) => setThankYouStartFilter(event.target.value)}
                  type="datetime-local"
                  value={thankYouStartFilter}
                />
              </label>
              <label>
                <span>終了日時</span>
                <input
                  onChange={(event) => setThankYouEndFilter(event.target.value)}
                  type="datetime-local"
                  value={thankYouEndFilter}
                />
              </label>
              <label>
                <span>補助検索</span>
                <input
                  onChange={(event) => setThankYouKeywordFilter(event.target.value)}
                  placeholder="名前・メール・ID"
                  type="search"
                  value={thankYouKeywordFilter}
                />
              </label>
            </div>
            <div className="thank-you-delete-list">
              {loadingThankYouEvents ? (
                <p className="muted">読み込み中...</p>
              ) : filteredThankYouEvents.length ? (
                filteredThankYouEvents.map((item) => {
                  const counts = eventInteractionCounts[item.id] ?? {
                    likes: 0,
                    comments: 0,
                  };

                  return (
                    <article className="thank-you-delete-row" key={item.id}>
                      <div className="thank-you-delete-time">
                        <strong>{formatDateTime(item.created_at)}</strong>
                        <span>ID {shortEventId(item.id)}</span>
                      </div>
                      <div className="adjustment-user">
                        <ProfileAvatar
                          name={thankYouEventUserName(item)}
                          src={item.profiles?.avatar_url}
                          avatarScale={item.profiles?.avatar_scale}
                          size="sm"
                        />
                        <div>
                          <span>{thankYouEventUserName(item)}</span>
                          <p>{item.profiles?.email || "メール未設定"}</p>
                        </div>
                      </div>
                      <div className="thank-you-delete-meta">
                        <span>いいね {formatNumber(counts.likes)}</span>
                        <span>コメント {formatNumber(counts.comments)}</span>
                      </div>
                      <button
                        className="button button-danger"
                        disabled={deletingThankYouEventId === item.id}
                        onClick={() => setThankYouEventToDelete(item)}
                        type="button"
                      >
                        <Trash2 aria-hidden="true" />
                        このありがとうを削除
                      </button>
                    </article>
                  );
                })
              ) : (
                <p className="muted">該当するありがとうはありません。</p>
              )}
            </div>
          </section>
          <button
            className="button button-danger full-width-button"
            disabled={clearingThankYous || !periodForm.id}
            onClick={() => setShowClearDialog(true)}
            type="button"
          >
            <Trash2 aria-hidden="true" />
            {clearingThankYous ? "削除中..." : "今期のありがとうを全削除"}
          </button>
          <div className="adjustment-history">
            {adjustments.length ? (
              adjustments.slice(0, 5).map((item) => (
                <div className="adjustment-row" key={item.id}>
                  <strong>
                    {item.delta > 0 ? "+" : ""}
                    {formatNumber(item.delta)}
                  </strong>
                  <div className="adjustment-user">
                    <ProfileAvatar
                      name={
                        item.profiles?.display_name ||
                        item.profiles?.email ||
                        "管理者"
                      }
                      src={item.profiles?.avatar_url}
                      avatarScale={item.profiles?.avatar_scale}
                      size="sm"
                    />
                    <div>
                      <span>
                        {item.profiles?.display_name ||
                          item.profiles?.email ||
                          "管理者"}
                      </span>
                      <p>
                        {formatDateTime(item.created_at)}
                        {item.reason ? ` / ${item.reason}` : ""}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">補正履歴はまだありません。</p>
            )}
          </div>
        </article>
      </section>
      ) : section === "chatwork" ? (
        <section className="admin-grid chatwork-grid">
          <article className="panel chatwork-panel">
            <div className="panel-title">
              <MessageCircle aria-hidden="true" />
              <div>
                <p className="eyebrow">Chatwork</p>
                <h2>チャットワーク連携</h2>
              </div>
            </div>
            <div
              className={`billing-status ${chatworkSettings?.enabled ? "live" : "offline"}`}
            >
              <span>
                {chatworkSettings?.enabled ? "月次通知 有効" : "月次通知 無効"}
              </span>
              <strong>毎月3日 9:00送信</strong>
            </div>
            <form className="form-stack" onSubmit={handleChatworkSave}>
              <label>
                <span>APIトークン</span>
                <div className="input-shell">
                  <KeyRound aria-hidden="true" />
                  <input
                    autoComplete="off"
                    onChange={(event) => setChatworkApiToken(event.target.value)}
                    placeholder={
                      chatworkSettings?.tokenConfigured
                        ? "変更する場合のみ入力"
                        : "Chatwork APIトークン"
                    }
                    type="password"
                    value={chatworkApiToken}
                  />
                </div>
              </label>
              <label className="checkbox-field">
                <input
                  checked={chatworkEnabled}
                  onChange={(event) => setChatworkEnabled(event.target.checked)}
                  type="checkbox"
                />
                <span>月次通知を有効にする</span>
              </label>
              <div className="chatwork-room-list">
                {chatworkRooms.map((room, index) => (
                  <section className="chatwork-room-config" key={room.id}>
                    <div className="chatwork-room-header">
                      <label className="checkbox-field chatwork-room-toggle">
                        <input
                          checked={room.enabled}
                          onChange={(event) =>
                            updateChatworkRoom(room.id, {
                              enabled: event.target.checked,
                            })
                          }
                          type="checkbox"
                        />
                        <span>{room.name.trim() || `送信先 ${index + 1}`}</span>
                      </label>
                      {chatworkRooms.length > 1 ? (
                        <button
                          aria-label="送信先を削除"
                          className="icon-button chatwork-room-remove"
                          onClick={() => removeChatworkRoom(room.id)}
                          type="button"
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                    <div className="form-grid chatwork-room-fields">
                      <label>
                        <span>表示名</span>
                        <input
                          onChange={(event) =>
                            updateChatworkRoom(room.id, {
                              name: event.target.value,
                            })
                          }
                          placeholder={`送信先 ${index + 1}`}
                          type="text"
                          value={room.name}
                        />
                      </label>
                      <label>
                        <span>ルームID</span>
                        <input
                          inputMode="numeric"
                          onChange={(event) =>
                            updateChatworkRoom(room.id, {
                              roomId: event.target.value,
                            })
                          }
                          placeholder="123456789"
                          required={chatworkEnabled && room.enabled}
                          type="text"
                          value={room.roomId}
                        />
                      </label>
                    </div>
                    <label>
                      <span>送信本文</span>
                      <textarea
                        className="chatwork-message-template"
                        onChange={(event) =>
                          updateChatworkRoom(room.id, {
                            messageTemplate: event.target.value,
                          })
                        }
                        required={chatworkEnabled && room.enabled}
                        rows={8}
                        value={room.messageTemplate}
                      />
                    </label>
                  </section>
                ))}
              </div>
              <button
                className="button button-secondary"
                onClick={addChatworkRoom}
                type="button"
              >
                <Plus aria-hidden="true" />
                送信先を追加
              </button>
              <button className="button button-primary" disabled={savingChatwork}>
                <MessageCircle aria-hidden="true" />
                {savingChatwork ? "保存中..." : "連携設定を保存"}
              </button>
            </form>
          </article>

          <article className="panel chatwork-panel">
            <div className="panel-title">
              <MessageCircle aria-hidden="true" />
              <div>
                <p className="eyebrow">Customer voices</p>
                <h2>いいお声の取込設定</h2>
              </div>
            </div>
            <p className="form-help">Chatworkの対象ルームから、【お声共有】の枠内にある文章だけを自動取得します。月次通知とは別に設定できます。</p>
            <form className="form-stack" onSubmit={handleChatworkSave}>
              <label className="checkbox-field">
                <input checked={goodVoiceEnabled} onChange={(event) => setGoodVoiceEnabled(event.target.checked)} type="checkbox" />
                <span>「いいお声」の自動取込を有効にする</span>
              </label>
              <div className="chatwork-room-list">
                {goodVoiceRooms.map((room, index) => (
                  <section className="chatwork-room-config" key={room.id}>
                    <div className="chatwork-room-header">
                      <label className="checkbox-field chatwork-room-toggle">
                        <input checked={room.enabled} onChange={(event) => updateGoodVoiceRoom(room.id, { enabled: event.target.checked })} type="checkbox" />
                        <span>{room.name.trim() || `取込ルーム ${index + 1}`}</span>
                      </label>
                      {goodVoiceRooms.length > 1 ? <button aria-label="取込ルームを削除" className="icon-button chatwork-room-remove" onClick={() => removeGoodVoiceRoom(room.id)} type="button"><Trash2 aria-hidden="true" /></button> : null}
                    </div>
                    <div className="form-grid chatwork-room-fields">
                      <label><span>表示名</span><input onChange={(event) => updateGoodVoiceRoom(room.id, { name: event.target.value })} placeholder={`取込ルーム ${index + 1}`} type="text" value={room.name} /></label>
                      <label><span>ルームID</span><input inputMode="numeric" onChange={(event) => updateGoodVoiceRoom(room.id, { roomId: event.target.value })} placeholder="123456789" required={goodVoiceEnabled && room.enabled} type="text" value={room.roomId} /></label>
                    </div>
                  </section>
                ))}
              </div>
              <button className="button button-secondary" onClick={addGoodVoiceRoom} type="button"><Plus aria-hidden="true" />取込ルームを追加</button>
              <button className="button button-primary" disabled={savingChatwork}><MessageCircle aria-hidden="true" />{savingChatwork ? "保存中..." : "いいお声の設定を保存"}</button>
            </form>
          </article>

          <article className="panel chatwork-panel">
            <div className="panel-title">
              <Pencil aria-hidden="true" />
              <div>
                <p className="eyebrow">Manual entry</p>
                <h2>いいお声を手動で追加</h2>
              </div>
            </div>
            <p className="form-help">Chatworkに共有していないお声も、ここから直接登録できます。</p>
            <form className="form-stack" onSubmit={handleAddManualGoodVoice}>
              <label>
                <span>いいお声の本文</span>
                <textarea
                  onChange={(event) => setManualGoodVoiceBody(event.target.value)}
                  placeholder="例：目のかすみがとれて、はっきり見えるようになりました。"
                  required
                  rows={6}
                  value={manualGoodVoiceBody}
                />
              </label>
              <div className="form-grid chatwork-room-fields">
                <label>
                  <span>お客様名・補足（任意）</span>
                  <input onChange={(event) => setManualGoodVoiceAuthor(event.target.value)} placeholder="任意" value={manualGoodVoiceAuthor} />
                </label>
                <label>
                  <span>発生日</span>
                  <input onChange={(event) => setManualGoodVoiceDate(event.target.value)} required type="date" value={manualGoodVoiceDate} />
                </label>
              </div>
              <button className="button button-primary" disabled={addingManualGoodVoice} type="submit">
                <Pencil aria-hidden="true" />
                {addingManualGoodVoice ? "追加中..." : "いいお声を追加"}
              </button>
            </form>
            <div className="manual-good-voice-history">
              <div className="subsection-heading">
                <div>
                  <p className="eyebrow">Manual history</p>
                  <h3>手動で追加したお声</h3>
                </div>
                <span>{formatNumber(manualGoodVoices.length)}件</span>
              </div>
              {manualGoodVoices.length ? (
                <div className="manual-good-voice-list">
                  {manualGoodVoices.map((voice) => (
                    <article className="manual-good-voice-row" key={voice.id}>
                      <div className="manual-good-voice-content">
                        <p>{voice.message_body}</p>
                        <span>
                          {voice.author_name || "お客様"} / {formatDateTime(voice.sent_at)}
                        </span>
                      </div>
                      <button
                        className="button button-danger manual-good-voice-delete"
                        disabled={deletingManualGoodVoiceId === voice.id}
                        onClick={() => setManualGoodVoiceToDelete(voice)}
                        type="button"
                      >
                        <Trash2 aria-hidden="true" />
                        {deletingManualGoodVoiceId === voice.id ? "削除中..." : "削除"}
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="form-help">手動で追加したお声はまだありません。</p>
              )}
            </div>
          </article>

          <article className="panel chatwork-panel">
            <div className="panel-title">
              <Send aria-hidden="true" />
              <div>
                <p className="eyebrow">Preview</p>
                <h2>送信プレビュー</h2>
              </div>
            </div>
            <div className="billing-metrics">
              <div>
                <span>対象月</span>
                <strong>{chatworkPreview?.targetMonthLabel ?? "未取得"}</strong>
              </div>
              <div>
                <span>累計ありがとう</span>
                <strong>
                  {formatNumber(chatworkPreview?.cumulativeTotal ?? 0)}
                </strong>
              </div>
              <div>
                <span>月のありがとう</span>
                <strong>{formatNumber(chatworkPreview?.monthlyTotal ?? 0)}</strong>
              </div>
            </div>
            <div className="chatwork-preview-list">
              {chatworkPreviewMessages.length ? (
                chatworkPreviewMessages.map((item) => (
                  <div className="chatwork-preview-item" key={item.roomId}>
                    <div className="chatwork-preview-heading">
                      <strong>{item.roomName || `ルーム ${item.roomId}`}</strong>
                      <span>{item.roomId}</span>
                    </div>
                    <pre className="chatwork-message-preview">{item.message}</pre>
                  </div>
                ))
              ) : (
                <pre className="chatwork-message-preview">読み込み中...</pre>
              )}
            </div>
            <div className="billing-actions">
              <button
                className="button button-secondary"
                disabled={sendingChatwork !== null || loading || !canSendChatwork}
                onClick={() => void sendChatwork("send-test")}
                type="button"
              >
                <Send aria-hidden="true" />
                {sendingChatwork === "test" ? "送信中..." : "テスト送信"}
              </button>
              <button
                className="button button-primary"
                disabled={sendingChatwork !== null || loading || !canSendChatwork}
                onClick={() => void sendChatwork("send-monthly")}
                type="button"
              >
                <MessageCircle aria-hidden="true" />
                {sendingChatwork === "monthly" ? "送信中..." : "今すぐ月次送信"}
              </button>
            </div>
            <div className="chatwork-last-send">
              <span>送信履歴</span>
              {chatworkLastNotifications.length ? (
                <div className="chatwork-notification-list">
                  {chatworkLastNotifications.slice(0, 6).map((item, index) => (
                    <div
                      className="chatwork-notification-row"
                      key={`${item.target_month}-${item.room_id ?? index}-${index}`}
                    >
                      <strong>
                        {item.room_name ||
                          (item.room_id ? `ルーム ${item.room_id}` : "送信先")}
                      </strong>
                      <p>
                        {formatMonthDate(item.target_month)} /{" "}
                        {item.status === "sent" ? "送信済み" : "失敗"}
                        {item.sent_at ? ` / ${formatDateTime(item.sent_at)}` : ""}
                      </p>
                      {item.error_message ? <p>{item.error_message}</p> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <strong>未送信</strong>
              )}
            </div>
          </article>
        </section>
      ) : (
        <section className="admin-grid billing-grid">
          <article className="panel billing-panel">
            <div className="panel-title">
              <CreditCard aria-hidden="true" />
              <div>
                <p className="eyebrow">Billing</p>
                <h2>利用料</h2>
              </div>
            </div>
            <div
              className={`billing-status ${billingUsage?.live ? "live" : "offline"}`}
            >
              <span>{billingUsage?.live ? "ライブ取得中" : "Management API未接続"}</span>
              <strong>
                最終取得:{" "}
                {billingLoading ? "取得中..." : formatBillingDate(billingUsage?.generatedAt)}
              </strong>
            </div>
            <div className="billing-hero">
              <div>
                <span>オキアリ追加分</span>
                <strong>{formatYenFromUsd(billingAddedCost)}</strong>
                <p>
                  このプロジェクトで選択中のCompute/アドオンだけを円換算した月額目安です。
                </p>
              </div>
              <div>
                <span>契約プラン</span>
                <strong>{billingPlanLabel}</strong>
                <p>
                  {billingUsage?.organization
                    ? `${billingUsage.organization.name} の基本契約です。追加費用の合計には含めません。`
                    : "Organization情報はまだ取得できていません。"}
                </p>
              </div>
            </div>

            {billingUsage?.message ? (
              <p className="billing-note">
                {billingUsage.message}
                {billingUsage.missing?.length
                  ? ` 必要な設定: ${billingUsage.missing.join(", ")}`
                  : ""}
              </p>
            ) : null}

            <div className="billing-metrics">
              <div>
                <span>追加費用合計</span>
                <strong>{formatYenFromUsd(billingAddedCost)}</strong>
              </div>
              <div>
                <span>換算レート</span>
                <strong>{formatNumber(usdToJpyRate)}円</strong>
              </div>
              <div>
                <span>APIリクエスト</span>
                <strong>
                  {typeof billingUsage?.apiRequestCount === "number"
                    ? formatNumber(billingUsage.apiRequestCount)
                    : "未取得"}
                </strong>
              </div>
            </div>

            <div className="billing-list">
              <div className="billing-row">
                <div>
                  <strong>GitHub Pages</strong>
                  <span>Static hosting</span>
                </div>
                <p>静的サイト公開。GitHub Pages側の追加利用料はこのアプリでは発生しません。</p>
                <strong>0円</strong>
              </div>
              <div className="billing-row">
                <div>
                  <strong>API内訳</strong>
                  <span>最新の1日集計</span>
                </div>
                <p>
                  Auth {formatNumber(billingBreakdown.auth)} / REST{" "}
                  {formatNumber(billingBreakdown.rest)} / Realtime{" "}
                  {formatNumber(billingBreakdown.realtime)} / Storage{" "}
                  {formatNumber(billingBreakdown.storage)}
                </p>
                <strong>使用量</strong>
              </div>
              {billingUsage?.selectedAddons?.length ? (
                billingUsage.selectedAddons.map((item) => (
                  <div className="billing-row" key={`${item.type}-${item.variantId}`}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.type}</span>
                    </div>
                    <p>
                      {item.price?.description ?? "Supabase Management API価格情報"}
                      {item.price?.interval ? ` / ${item.price.interval}` : ""}
                    </p>
                    <strong>{formatYenFromUsd(item.estimatedMonthlyUsd)}</strong>
                  </div>
                ))
              ) : (
                <div className="billing-row">
                  <div>
                    <strong>選択中アドオン</strong>
                    <span>Billing add-ons</span>
                  </div>
                  <p>選択中の有料アドオンは取得されていません。</p>
                  <strong>0円</strong>
                </div>
              )}
            </div>
            <div className="billing-actions">
              {billingUsage?.billingPageUrl ? (
                <a
                  className="button button-primary"
                  href={billingUsage.billingPageUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink aria-hidden="true" />
                  Supabase請求画面
                </a>
              ) : null}
              {billingUsage?.usagePageUrl ? (
                <a
                  className="button button-secondary"
                  href={billingUsage.usagePageUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink aria-hidden="true" />
                  使用量画面
                </a>
              ) : null}
            </div>
            {billingUsage?.warnings?.length ? (
              <div className="billing-warning">
                {billingUsage.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
            <p className="billing-note">
              この画面はSupabase Management APIから取得できる利用情報を表示しています。
              金額は1ドル={formatNumber(usdToJpyRate)}円で換算しています。税金、割引、請求締め後の確定金額はSupabaseの請求画面で確認してください。
            </p>
          </article>
        </section>
      )}

      {showClearDialog ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-thank-yous-title"
          >
            <div className="confirm-icon">
              <TriangleAlert aria-hidden="true" />
            </div>
            <div>
              <p className="eyebrow">Delete</p>
              <h2 id="clear-thank-yous-title">今期のありがとうを全削除しますか？</h2>
              <p>
                押下されたありがとう、いいね、コメント、補正履歴をすべて削除します。
                この操作は元に戻せません。
              </p>
            </div>
            <div className="confirm-modal-actions">
              <button
                className="button button-secondary"
                disabled={clearingThankYous}
                onClick={() => setShowClearDialog(false)}
                type="button"
              >
                キャンセル
              </button>
              <button
                className="button button-danger"
                disabled={clearingThankYous}
                onClick={() => void handleClearThankYous()}
                type="button"
              >
                <Trash2 aria-hidden="true" />
                {clearingThankYous ? "削除中..." : "全削除する"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {thankYouEventToDelete ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-thank-you-event-title"
          >
            <div className="confirm-icon">
              <TriangleAlert aria-hidden="true" />
            </div>
            <div>
              <p className="eyebrow">Delete</p>
              <h2 id="delete-thank-you-event-title">
                このありがとうを削除しますか？
              </h2>
              <p>
                {thankYouEventUserName(thankYouEventToDelete)} /{" "}
                {formatDateTime(thankYouEventToDelete.created_at)} / ID{" "}
                {shortEventId(thankYouEventToDelete.id)}
              </p>
            </div>
            <div className="confirm-modal-actions">
              <button
                className="button button-secondary"
                disabled={deletingThankYouEventId === thankYouEventToDelete.id}
                onClick={() => setThankYouEventToDelete(null)}
                type="button"
              >
                キャンセル
              </button>
              <button
                className="button button-danger"
                disabled={deletingThankYouEventId === thankYouEventToDelete.id}
                onClick={() => void handleDeleteThankYouEvent()}
                type="button"
              >
                <Trash2 aria-hidden="true" />
                {deletingThankYouEventId === thankYouEventToDelete.id
                  ? "削除中..."
                  : "削除する"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {manualGoodVoiceToDelete ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-manual-good-voice-title"
          >
            <div className="confirm-icon">
              <TriangleAlert aria-hidden="true" />
            </div>
            <div>
              <p className="eyebrow">Delete</p>
              <h2 id="delete-manual-good-voice-title">このお声を削除しますか？</h2>
              <p>削除後は管理画面とダッシュボードから表示されなくなります。</p>
              <p className="manual-good-voice-delete-preview">
                {manualGoodVoiceToDelete.message_body}
              </p>
            </div>
            <div className="confirm-modal-actions">
              <button
                className="button button-secondary"
                disabled={Boolean(deletingManualGoodVoiceId)}
                onClick={() => setManualGoodVoiceToDelete(null)}
                type="button"
              >
                キャンセル
              </button>
              <button
                className="button button-danger"
                disabled={Boolean(deletingManualGoodVoiceId)}
                onClick={() => void handleDeleteManualGoodVoice()}
                type="button"
              >
                <Trash2 aria-hidden="true" />
                {deletingManualGoodVoiceId ? "削除中..." : "削除する"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
