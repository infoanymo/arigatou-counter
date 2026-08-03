import { createClient } from "npm:@supabase/supabase-js@2.111.0";

type SupabaseAdmin = ReturnType<typeof createClient>;

type ChatworkSettings = {
  id: number;
  api_token: string | null;
  room_id: string | null;
  enabled: boolean;
  updated_at: string;
  updated_by: string | null;
};

type ChatworkNotification = {
  id: string;
  target_month: string;
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jstOffsetMs = 9 * 60 * 60 * 1000;

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

async function loadLastNotification(admin: SupabaseAdmin) {
  const { data, error } = await admin
    .from("chatwork_monthly_notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new HttpError(error.message, 400);
  return (data ?? null) as ChatworkNotification | null;
}

function publicSettings(settings: ChatworkSettings | null) {
  return {
    enabled: settings?.enabled ?? false,
    roomId: settings?.room_id ?? "",
    tokenConfigured: Boolean(settings?.api_token),
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

function buildMessage(summary: ReportSummary) {
  return `[toall]
[info][title]内容：ありがとう集計[/title]
担当部署：CS/CX
【通知内容】
累計ありがとう：${formatCount(summary.cumulativeTotal)}
${summary.targetMonthLabel}のありがとう：${formatCount(summary.monthlyTotal)}[/info]`;
}

async function postChatworkMessage(settings: ChatworkSettings, message: string) {
  if (!settings.api_token || !settings.room_id) {
    throw new HttpError("Chatwork API token and room ID are required.", 400);
  }

  const response = await fetch(
    `https://api.chatwork.com/v2/rooms/${settings.room_id}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-chatworktoken": settings.api_token,
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

async function settingsResponse(admin: SupabaseAdmin, targetMonthValue?: string) {
  const [settings, preview, lastNotification] = await Promise.all([
    loadSettings(admin),
    buildReportSummary(admin, targetMonthValue),
    loadLastNotification(admin),
  ]);

  return {
    settings: publicSettings(settings),
    preview: {
      ...preview,
      message: buildMessage(preview),
    },
    lastNotification,
  };
}

async function saveSettings(
  admin: SupabaseAdmin,
  callerId: string,
  body: Record<string, unknown>,
) {
  const current = await loadSettings(admin);
  const apiToken = cleanText(body.apiToken);
  const roomId = cleanRoomId(body.roomId);
  const enabled = body.enabled === true;
  const nextToken = body.clearToken === true ? null : apiToken || current?.api_token || null;

  if (enabled && !nextToken) {
    throw new HttpError("Chatwork API token is required.", 400);
  }

  if (enabled && !roomId) {
    throw new HttpError("Valid Chatwork room ID is required.", 400);
  }

  const { data, error } = await admin
    .from("chatwork_settings")
    .upsert(
      {
        id: 1,
        api_token: nextToken,
        room_id: roomId || null,
        enabled,
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

  if (!settings?.enabled) {
    throw new HttpError("Chatwork連携が無効です。", 400);
  }

  if (!settings.api_token || !settings.room_id) {
    throw new HttpError("Chatwork API token and room ID are required.", 400);
  }

  return settings;
}

async function sendTest(admin: SupabaseAdmin, targetMonthValue?: string) {
  const settings = await ensureSendableSettings(admin);
  const summary = await buildReportSummary(admin, targetMonthValue);
  const message = buildMessage(summary);
  const chatworkResponse = await postChatworkMessage(settings, message);

  return {
    ok: true,
    messageId: chatworkResponse?.message_id ? String(chatworkResponse.message_id) : null,
    preview: {
      ...summary,
      message,
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
  const settings = await ensureSendableSettings(admin);
  const summary = await buildReportSummary(admin, options.targetMonth);
  const message = buildMessage(summary);

  if (!options.force) {
    const { data: existing, error: existingError } = await admin
      .from("chatwork_monthly_notifications")
      .select("*")
      .eq("target_month", summary.targetMonth)
      .eq("status", "sent")
      .maybeSingle();

    if (existingError) throw new HttpError(existingError.message, 400);

    if (existing) {
      return {
        ok: true,
        skipped: true,
        reason: "already_sent",
        notification: existing,
        preview: {
          ...summary,
          message,
        },
      };
    }
  }

  try {
    const chatworkResponse = await postChatworkMessage(settings, message);
    const messageId = chatworkResponse?.message_id
      ? String(chatworkResponse.message_id)
      : null;

    const { data, error } = await admin
      .from("chatwork_monthly_notifications")
      .upsert(
        {
          target_month: summary.targetMonth,
          status: "sent",
          cumulative_count: summary.cumulativeTotal,
          monthly_count: summary.monthlyTotal,
          message_body: message,
          chatwork_message_id: messageId,
          response: chatworkResponse,
          error_message: null,
          sent_at: new Date().toISOString(),
          triggered_by: options.triggeredBy,
        },
        { onConflict: "target_month" },
      )
      .select("*")
      .single();

    if (error) throw new HttpError(error.message, 400);

    return {
      ok: true,
      notification: data,
      preview: {
        ...summary,
        message,
      },
    };
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "Chatwork送信に失敗しました。";

    await admin.from("chatwork_monthly_notifications").upsert(
      {
        target_month: summary.targetMonth,
        status: "failed",
        cumulative_count: summary.cumulativeTotal,
        monthly_count: summary.monthlyTotal,
        message_body: message,
        chatwork_message_id: null,
        response: null,
        error_message: messageText,
        sent_at: null,
        triggered_by: options.triggeredBy,
      },
      { onConflict: "target_month" },
    );

    throw error;
  }
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
