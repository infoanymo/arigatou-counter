import { createClient } from "npm:@supabase/supabase-js@2.111.0";

type SupabaseAdmin = ReturnType<typeof createClient>;

type ChatworkSettings = {
  id: number;
  api_token: string | null;
  room_id: string | null;
  rooms: unknown;
  enabled: boolean;
  good_voice_enabled: boolean;
  good_voice_rooms: unknown;
  good_voice_keywords: string[] | null;
  updated_at: string;
  updated_by: string | null;
};

type ChatworkRoom = {
  id: string;
  name: string;
  roomId: string;
  messageTemplate: string;
  enabled: boolean;
};

type ChatworkNotification = {
  id: string;
  target_month: string;
  room_id: string | null;
  room_name: string | null;
  status: "sent" | "failed";
  cumulative_count: number | null;
  monthly_count: number | null;
  chatwork_message_id: string | null;
  error_message: string | null;
  sent_at: string | null;
  triggered_by: string | null;
  created_at: string;
};

type ReportSummary = {
  targetMonth: string;
  targetMonthLabel: string;
  startIso: string;
  endIso: string;
  cumulativeTotal: number;
  monthlyTotal: number;
};

type ChatworkMessagePreview = {
  roomId: string;
  roomName: string;
  message: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jstOffsetMs = 9 * 60 * 60 * 1000;
const defaultMessageTemplate = `[toall]
[info][title]内容：ありがとう集計[/title]
担当部署：CS/CX
【通知内容】
累計ありがとう：{{cumulativeTotal}}
{{targetMonth}}のありがとう：{{monthlyTotal}}[/info]`;

class HttpError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanRoomId(value: unknown) {
  const text = cleanText(value);
  if (!text) return "";

  const ridMatch = text.match(/rid(\d+)/i);
  if (ridMatch) return ridMatch[1];
  if (/^\d+$/.test(text)) return text;

  return "";
}

function cleanRoomName(value: unknown, roomId: string) {
  const text = cleanText(value);
  return text || `ルーム ${roomId}`;
}

function cleanMessageTemplate(value: unknown) {
  return cleanText(value) || defaultMessageTemplate;
}

function roomValue(
  raw: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
) {
  return raw[camelKey] ?? raw[snakeKey];
}

function normalizeRoomRecord(rawValue: unknown, index: number) {
  if (!rawValue || typeof rawValue !== "object") return null;

  const raw = rawValue as Record<string, unknown>;
  const roomId = cleanRoomId(roomValue(raw, "roomId", "room_id"));
  if (!roomId) return null;

  return {
    id: cleanText(raw.id) || `${roomId}-${index}`,
    name: cleanRoomName(raw.name, roomId),
    roomId,
    messageTemplate: cleanMessageTemplate(
      roomValue(raw, "messageTemplate", "message_template"),
    ),
    enabled: raw.enabled !== false,
  };
}

function normalizeRooms(value: unknown, fallbackRoomId?: unknown) {
  const rooms: ChatworkRoom[] = [];

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const room = normalizeRoomRecord(item, index);
      if (room) rooms.push(room);
    });
  }

  if (!rooms.length) {
    const roomId = cleanRoomId(fallbackRoomId);
    if (roomId) {
      rooms.push({
        id: roomId,
        name: cleanRoomName("", roomId),
        roomId,
        messageTemplate: defaultMessageTemplate,
        enabled: true,
      });
    }
  }

  return rooms;
}

function duplicateRoomIds(rooms: ChatworkRoom[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  rooms.forEach((room) => {
    if (seen.has(room.roomId)) duplicates.add(room.roomId);
    seen.add(room.roomId);
  });

  return [...duplicates];
}

function roomsForSettings(settings: ChatworkSettings | null) {
  return normalizeRooms(settings?.rooms, settings?.room_id);
}

function enabledRoomsForSettings(settings: ChatworkSettings | null) {
  return roomsForSettings(settings).filter((room) => room.enabled);
}

function goodVoiceRoomsForSettings(settings: ChatworkSettings | null) {
  return normalizeRooms(settings?.good_voice_rooms);
}

function enabledGoodVoiceRoomsForSettings(settings: ChatworkSettings | null) {
  return goodVoiceRoomsForSettings(settings).filter((room) => room.enabled);
}

function getAdminKey() {
  const legacyServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyServiceRole) return legacyServiceRole;

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!secretKeys) return null;

  try {
    const parsed = JSON.parse(secretKeys) as Record<string, string>;
    return parsed.default ?? Object.values(parsed)[0] ?? null;
  } catch {
    return null;
  }
}

function bearerToken(req: Request) {
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
}

function isSecretRequest(req: Request, secretKey: string) {
  const bearer = bearerToken(req);
  return (
    bearer === secretKey ||
    req.headers.get("apikey") === secretKey ||
    req.headers.get("x-supabase-key") === secretKey
  );
}

async function authorizeAdmin(req: Request, admin: SupabaseAdmin) {
  const jwt = bearerToken(req);
  if (!jwt) throw new HttpError("Authentication is required.", 401);

  const {
    data: { user },
    error,
  } = await admin.auth.getUser(jwt);

  if (error || !user) throw new HttpError("Authentication is invalid.", 401);

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("status")
    .eq("id", user.id)
    .single();

  if (profileError || profile?.status !== "active") {
    throw new HttpError("This account cannot manage Chatwork settings.", 403);
  }

  if (user.app_metadata?.role !== "admin") {
    throw new HttpError("Admin role is required.", 403);
  }

  return user;
}

async function loadSettings(admin: SupabaseAdmin) {
  const { data, error } = await admin
    .from("chatwork_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) throw new HttpError(error.message, 400);
  return (data ?? null) as ChatworkSettings | null;
}

async function loadRecentNotifications(admin: SupabaseAdmin) {
  const { data, error } = await admin
    .from("chatwork_monthly_notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) throw new HttpError(error.message, 400);
  return (data ?? []) as ChatworkNotification[];
}

function publicSettings(settings: ChatworkSettings | null) {
  const rooms = roomsForSettings(settings);

  return {
    enabled: settings?.enabled ?? false,
    roomId: rooms[0]?.roomId ?? settings?.room_id ?? "",
    rooms,
    tokenConfigured: Boolean(settings?.api_token),
    goodVoiceEnabled: settings?.good_voice_enabled ?? false,
    goodVoiceRooms: goodVoiceRoomsForSettings(settings),
    goodVoiceKeywords: settings?.good_voice_keywords ?? [],
    updatedAt: settings?.updated_at ?? null,
  };
}

function monthBounds(targetMonthValue?: string) {
  if (targetMonthValue && /^\d{4}-\d{2}$/.test(targetMonthValue)) {
    const [year, month] = targetMonthValue.split("-").map(Number);
    const startUtcMs = Date.UTC(year, month - 1, 1) - jstOffsetMs;
    const endUtcMs = Date.UTC(year, month, 1) - jstOffsetMs;
    return {
      targetMonth: `${year}-${String(month).padStart(2, "0")}-01`,
      targetMonthLabel: `${month}月`,
      startIso: new Date(startUtcMs).toISOString(),
      endIso: new Date(endUtcMs).toISOString(),
    };
  }

  const now = new Date(Date.now() + jstOffsetMs);
  let year = now.getUTCFullYear();
  let monthIndex = now.getUTCMonth() - 1;

  if (monthIndex < 0) {
    year -= 1;
    monthIndex = 11;
  }

  const startUtcMs = Date.UTC(year, monthIndex, 1) - jstOffsetMs;
  const endUtcMs = Date.UTC(year, monthIndex + 1, 1) - jstOffsetMs;
  const month = monthIndex + 1;

  return {
    targetMonth: `${year}-${String(month).padStart(2, "0")}-01`,
    targetMonthLabel: `${month}月`,
    startIso: new Date(startUtcMs).toISOString(),
    endIso: new Date(endUtcMs).toISOString(),
  };
}

async function countEvents(
  admin: SupabaseAdmin,
  range: { from?: string; to?: string },
) {
  let query = admin
    .from("thank_you_events")
    .select("id", { count: "exact", head: true });

  query = query.eq("kind", "thank_you");

  if (range.from) query = query.gte("created_at", range.from);
  if (range.to) query = query.lt("created_at", range.to);

  const { count, error } = await query;
  if (error) throw new HttpError(error.message, 400);
  return count ?? 0;
}

async function sumAdjustments(
  admin: SupabaseAdmin,
  range: { from?: string; to?: string },
) {
  let query = admin.from("thank_you_adjustments").select("delta");

  if (range.from) query = query.gte("created_at", range.from);
  if (range.to) query = query.lt("created_at", range.to);

  const { data, error } = await query;
  if (error) throw new HttpError(error.message, 400);

  return (data ?? []).reduce(
    (sum: number, item: { delta?: number | null }) => sum + (item.delta ?? 0),
    0,
  );
}

async function buildReportSummary(
  admin: SupabaseAdmin,
  targetMonthValue?: string,
): Promise<ReportSummary> {
  const bounds = monthBounds(targetMonthValue);
  const [monthlyEvents, cumulativeEvents, monthlyAdjustments, cumulativeAdjustments] =
    await Promise.all([
      countEvents(admin, { from: bounds.startIso, to: bounds.endIso }),
      countEvents(admin, { to: bounds.endIso }),
      sumAdjustments(admin, { from: bounds.startIso, to: bounds.endIso }),
      sumAdjustments(admin, { to: bounds.endIso }),
    ]);

  return {
    ...bounds,
    cumulativeTotal: Math.max(0, cumulativeEvents + cumulativeAdjustments),
    monthlyTotal: Math.max(0, monthlyEvents + monthlyAdjustments),
  };
}

function formatCount(value: number) {
  return new Intl.NumberFormat("ja-JP").format(value);
}

function buildMessage(summary: ReportSummary, template = defaultMessageTemplate) {
  const replacements: Record<string, string> = {
    cumulativeTotal: formatCount(summary.cumulativeTotal),
    monthlyTotal: formatCount(summary.monthlyTotal),
    targetMonth: summary.targetMonthLabel,
    targetMonthLabel: summary.targetMonthLabel,
    targetMonthStart: summary.targetMonth,
    累計ありがとう: formatCount(summary.cumulativeTotal),
    月のありがとう: formatCount(summary.monthlyTotal),
    対象月: summary.targetMonthLabel,
  };

  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => {
    return replacements[key] ?? "";
  });
}

function buildRoomMessages(
  summary: ReportSummary,
  rooms: ChatworkRoom[],
): ChatworkMessagePreview[] {
  return rooms.map((room) => ({
    roomId: room.roomId,
    roomName: room.name,
    message: buildMessage(summary, room.messageTemplate),
  }));
}

async function postChatworkMessage(
  apiToken: string | null,
  roomId: string,
  message: string,
) {
  if (!apiToken || !roomId) {
    throw new HttpError("Chatwork API token and room ID are required.", 400);
  }

  const response = await fetch(
    `https://api.chatwork.com/v2/rooms/${roomId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-chatworktoken": apiToken,
      },
      body: new URLSearchParams({
        body: message,
        self_unread: "0",
      }),
    },
  );
  const text = await response.text();
  let parsed: unknown = null;

  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    const errors = (parsed as { errors?: unknown })?.errors;
    const detail = Array.isArray(errors) ? errors.join(", ") : text;
    throw new HttpError(
      `Chatwork送信に失敗しました。(${response.status}) ${detail}`.trim(),
      502,
    );
  }

  return parsed as { message_id?: string | number } | null;
}

type ChatworkIncomingMessage = {
  message_id?: string | number;
  account?: { name?: string };
  body?: string;
  send_time?: number;
};

async function fetchChatworkMessages(
  apiToken: string,
  roomId: string,
  lastMessageId: string | null,
) {
  const params = new URLSearchParams({ force: "1" });
  if (lastMessageId) params.set("start_from", lastMessageId);
  const response = await fetch(
    `https://api.chatwork.com/v2/rooms/${roomId}/messages?${params.toString()}`,
    { headers: { "x-chatworktoken": apiToken } },
  );
  const text = await response.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!response.ok) {
    throw new HttpError(`Chatworkメッセージ取得に失敗しました。(${response.status})`, 502);
  }
  return Array.isArray(parsed) ? parsed as ChatworkIncomingMessage[] : [];
}

function extractGoodVoiceBody(body: string) {
  const marker = "【お声共有】";
  const markerIndex = body.indexOf(marker);
  if (markerIndex < 0) return null;

  let extracted = body.slice(markerIndex + marker.length);
  extracted = extracted.replace(/^\s*\[\/title\]\s*/i, "");
  const closingInfoIndex = extracted.search(/\[\/info\]/i);
  if (closingInfoIndex >= 0) extracted = extracted.slice(0, closingInfoIndex);
  extracted = extracted.replace(/\[\/?(?:info|title)\]/gi, "").trim();
  return extracted || null;
}

async function syncGoodVoices(admin: SupabaseAdmin) {
  const settings = await loadSettings(admin);
  if (!settings?.good_voice_enabled || !settings.api_token) {
    return { ok: true, imported: 0, skipped: "disabled" };
  }
  const rooms = enabledGoodVoiceRoomsForSettings(settings);
  let imported = 0;

  for (const room of rooms) {
    const { data: state } = await admin
      .from("chatwork_good_voice_sync_state")
      .select("last_message_id")
      .eq("room_id", room.roomId)
      .maybeSingle();
    const messages = await fetchChatworkMessages(settings.api_token, room.roomId, state?.last_message_id ?? null);
    let newestMessageId = state?.last_message_id ?? null;

    for (const message of messages) {
      const messageId = message.message_id ? String(message.message_id) : "";
      const body = extractGoodVoiceBody(cleanText(message.body));
      if (!messageId) continue;
      newestMessageId = messageId;
      if (!body) continue;
      const { error } = await admin.from("chatwork_good_voices").upsert({
        chatwork_message_id: messageId,
        room_id: room.roomId,
        room_name: room.name,
        author_name: cleanText(message.account?.name) || null,
        message_body: body,
        sent_at: message.send_time ? new Date(message.send_time * 1000).toISOString() : new Date().toISOString(),
      }, { onConflict: "chatwork_message_id", ignoreDuplicates: true });
      if (!error) imported += 1;
    }

    if (newestMessageId) {
      await admin.from("chatwork_good_voice_sync_state").upsert({
        room_id: room.roomId,
        last_message_id: newestMessageId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "room_id" });
    }
  }
  return { ok: true, imported };
}

async function addManualGoodVoice(
  admin: SupabaseAdmin,
  body: Record<string, unknown>,
) {
  const messageBody = cleanText(body.messageBody);
  if (!messageBody) throw new HttpError("いいお声の本文を入力してください。", 400);

  const sentAtValue = cleanText(body.sentAt);
  const sentAt = sentAtValue ? new Date(sentAtValue) : new Date();
  if (Number.isNaN(sentAt.getTime())) {
    throw new HttpError("日付の形式が正しくありません。", 400);
  }

  const { data, error } = await admin
    .from("chatwork_good_voices")
    .insert({
      chatwork_message_id: null,
      room_id: "manual",
      room_name: "手動入力",
      author_name: cleanText(body.authorName) || null,
      message_body: messageBody,
      sent_at: sentAt.toISOString(),
    })
    .select("id,chatwork_message_id,room_id,room_name,author_name,message_body,sent_at")
    .single();

  if (error) throw new HttpError(error.message, 400);
  return { voice: data };
}

async function listManualGoodVoices(admin: SupabaseAdmin) {
  const { data, error } = await admin
    .from("chatwork_good_voices")
    .select("id,chatwork_message_id,room_id,room_name,author_name,message_body,sent_at,created_at")
    // Older hand-entered records may predate the `room_id = manual` marker.
    // A null Chatwork message id is the durable signal that the record was not imported.
    .or("room_id.eq.manual,chatwork_message_id.is.null")
    .order("sent_at", { ascending: false })
    .limit(5000);

  if (error) throw new HttpError(error.message, 500);
  return data ?? [];
}

async function deleteManualGoodVoice(
  admin: SupabaseAdmin,
  body: Record<string, unknown>,
) {
  const id = cleanText(body.id);
  if (!id) throw new HttpError("削除対象のお声が指定されていません。", 400);

  const { data, error } = await admin
    .from("chatwork_good_voices")
    .delete()
    .eq("id", id)
    .is("chatwork_message_id", null)
    .select("id")
    .maybeSingle();

  if (error) throw new HttpError(error.message, 400);
  if (!data) throw new HttpError("削除対象のお声が見つかりません。", 404);
  return { ok: true, id: data.id };
}

async function settingsResponse(admin: SupabaseAdmin, targetMonthValue?: string) {
  const [settings, preview, lastNotifications, manualGoodVoices] = await Promise.all([
    loadSettings(admin),
    buildReportSummary(admin, targetMonthValue),
    loadRecentNotifications(admin),
    listManualGoodVoices(admin),
  ]);
  const rooms = enabledRoomsForSettings(settings);
  const messages = buildRoomMessages(
    preview,
    rooms.length ? rooms : roomsForSettings(settings),
  );

  return {
    settings: publicSettings(settings),
    preview: {
      ...preview,
      message: messages[0]?.message ?? buildMessage(preview),
      messages,
    },
    lastNotification: lastNotifications[0] ?? null,
    lastNotifications,
    manualGoodVoices,
  };
}

async function saveSettings(
  admin: SupabaseAdmin,
  callerId: string,
  body: Record<string, unknown>,
) {
  const current = await loadSettings(admin);
  const apiToken = cleanText(body.apiToken);
  const rooms = normalizeRooms(body.rooms, body.roomId);
  const enabledRooms = rooms.filter((room) => room.enabled);
  const duplicates = duplicateRoomIds(rooms);
  const roomId = enabledRooms[0]?.roomId ?? rooms[0]?.roomId ?? "";
  const enabled = body.enabled === true;
  const goodVoiceEnabled = body.goodVoiceEnabled === true;
  const goodVoiceRooms = normalizeRooms(body.goodVoiceRooms);
  const goodVoiceKeywords = Array.isArray(body.goodVoiceKeywords)
    ? body.goodVoiceKeywords.map(cleanText).filter(Boolean).slice(0, 20)
    : current?.good_voice_keywords ?? [];
  const nextToken = body.clearToken === true ? null : apiToken || current?.api_token || null;

  if (enabled && !nextToken) {
    throw new HttpError("Chatwork API token is required.", 400);
  }

  if (duplicates.length) {
    throw new HttpError(`Chatwork room ID is duplicated: ${duplicates.join(", ")}`, 400);
  }

  if (enabled && !enabledRooms.length) {
    throw new HttpError("At least one valid Chatwork room is required.", 400);
  }

  const { data, error } = await admin
    .from("chatwork_settings")
    .upsert(
      {
        id: 1,
        api_token: nextToken,
        room_id: roomId || null,
        rooms,
        enabled,
        good_voice_enabled: goodVoiceEnabled,
        good_voice_rooms: goodVoiceRooms,
        good_voice_keywords: goodVoiceKeywords,
        updated_by: callerId,
      },
      { onConflict: "id" },
    )
    .select("*")
    .single();

  if (error) throw new HttpError(error.message, 400);

  return {
    settings: publicSettings(data as ChatworkSettings),
  };
}

async function ensureSendableSettings(admin: SupabaseAdmin) {
  const settings = await loadSettings(admin);
  const rooms = enabledRoomsForSettings(settings);

  if (!settings?.enabled) {
    throw new HttpError("Chatwork連携が無効です。", 400);
  }

  if (!settings.api_token || !rooms.length) {
    throw new HttpError("Chatwork API token and room ID are required.", 400);
  }

  return { settings, rooms };
}

async function sendTest(admin: SupabaseAdmin, targetMonthValue?: string) {
  const { settings, rooms } = await ensureSendableSettings(admin);
  const summary = await buildReportSummary(admin, targetMonthValue);
  const messages = buildRoomMessages(summary, rooms);
  const messageIds: {
    roomId: string;
    roomName: string;
    messageId: string | null;
  }[] = [];

  for (const item of messages) {
    const chatworkResponse = await postChatworkMessage(
      settings.api_token,
      item.roomId,
      item.message,
    );

    messageIds.push({
      roomId: item.roomId,
      roomName: item.roomName,
      messageId: chatworkResponse?.message_id
        ? String(chatworkResponse.message_id)
        : null,
    });
  }

  return {
    ok: true,
    messageIds,
    preview: {
      ...summary,
      message: messages[0]?.message ?? buildMessage(summary),
      messages,
    },
  };
}

async function sendMonthly(
  admin: SupabaseAdmin,
  options: {
    force?: boolean;
    targetMonth?: string;
    triggeredBy: "admin" | "cron";
  },
) {
  const { settings, rooms } = await ensureSendableSettings(admin);
  const summary = await buildReportSummary(admin, options.targetMonth);
  const messages = buildRoomMessages(summary, rooms);
  const sentNotifications: unknown[] = [];
  const skippedNotifications: unknown[] = [];
  const failures: string[] = [];

  for (const item of messages) {
    const { data: existing, error: existingError } = await admin
      .from("chatwork_monthly_notifications")
      .select("*")
      .eq("target_month", summary.targetMonth)
      .eq("room_id", item.roomId)
      .eq("status", "sent")
      .maybeSingle();

    if (existingError) throw new HttpError(existingError.message, 400);

    if (!options.force && existing) {
      skippedNotifications.push(existing);
      continue;
    }

    try {
      const chatworkResponse = await postChatworkMessage(
        settings.api_token,
        item.roomId,
        item.message,
      );
      const messageId = chatworkResponse?.message_id
        ? String(chatworkResponse.message_id)
        : null;

      const { data, error } = await admin
        .from("chatwork_monthly_notifications")
        .upsert(
          {
            target_month: summary.targetMonth,
            room_id: item.roomId,
            room_name: item.roomName,
            status: "sent",
            cumulative_count: summary.cumulativeTotal,
            monthly_count: summary.monthlyTotal,
            message_body: item.message,
            chatwork_message_id: messageId,
            response: chatworkResponse,
            error_message: null,
            sent_at: new Date().toISOString(),
            triggered_by: options.triggeredBy,
          },
          { onConflict: "target_month,room_id" },
        )
        .select("*")
        .single();

      if (error) throw new HttpError(error.message, 400);

      sentNotifications.push(data);
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : "Chatwork送信に失敗しました。";

      await admin.from("chatwork_monthly_notifications").upsert(
        {
          target_month: summary.targetMonth,
          room_id: item.roomId,
          room_name: item.roomName,
          status: "failed",
          cumulative_count: summary.cumulativeTotal,
          monthly_count: summary.monthlyTotal,
          message_body: item.message,
          chatwork_message_id: null,
          response: null,
          error_message: messageText,
          sent_at: null,
          triggered_by: options.triggeredBy,
        },
        { onConflict: "target_month,room_id" },
      );

      failures.push(`${item.roomName}: ${messageText}`);
    }
  }

  if (failures.length) {
    throw new HttpError(
      `一部のChatwork送信に失敗しました。${failures.join(" / ")}`,
      502,
    );
  }

  return {
    ok: true,
    skipped: sentNotifications.length === 0 && skippedNotifications.length > 0,
    reason:
      sentNotifications.length === 0 && skippedNotifications.length > 0
        ? "already_sent"
        : undefined,
    notifications: sentNotifications,
    skippedNotifications,
    preview: {
      ...summary,
      message: messages[0]?.message ?? buildMessage(summary),
      messages,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = getAdminKey();

  if (!supabaseUrl || !secretKey) {
    return json({ error: "Supabase admin environment is not configured." }, 500);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = cleanText(body.action);

    if (action === "sync-good-voices" && isSecretRequest(req, secretKey)) {
      return json(await syncGoodVoices(admin));
    }

    if (action === "send-monthly" && isSecretRequest(req, secretKey)) {
      return json(
        await sendMonthly(admin, {
          force: body.force === true,
          targetMonth: cleanText(body.targetMonth),
          triggeredBy: "cron",
        }),
      );
    }

    const caller = await authorizeAdmin(req, admin);

    if (action === "get-settings") {
      return json(await settingsResponse(admin, cleanText(body.targetMonth)));
    }

    if (action === "save-settings") {
      return json(await saveSettings(admin, caller.id, body));
    }

    if (action === "add-manual-good-voice") {
      return json(await addManualGoodVoice(admin, body));
    }

    if (action === "delete-manual-good-voice") {
      return json(await deleteManualGoodVoice(admin, body));
    }

    if (action === "send-test") {
      return json(await sendTest(admin, cleanText(body.targetMonth)));
    }

    if (action === "send-monthly") {
      return json(
        await sendMonthly(admin, {
          force: body.force === true,
          targetMonth: cleanText(body.targetMonth),
          triggeredBy: "admin",
        }),
      );
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message }, error.status);
    }

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Chatwork連携の処理に失敗しました。",
      },
      500,
    );
  }
});
