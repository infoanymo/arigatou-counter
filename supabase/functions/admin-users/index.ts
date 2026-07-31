import { createClient } from "npm:@supabase/supabase-js@2.111.0";

type Role = "admin" | "member";
type Status = "active" | "disabled";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function cleanEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanRole(value: unknown): Role {
  return value === "admin" ? "admin" : "member";
}

function cleanStatus(value: unknown): Status | null {
  if (value === "active" || value === "disabled") return value;
  return null;
}

function siteUrl(req: Request) {
  const configuredUrl = Deno.env.get("APP_URL")?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");

  const referer = req.headers.get("referer")?.trim();
  if (referer) {
    try {
      const url = new URL(referer);
      return `${url.origin}${url.pathname}`.replace(/\/$/, "");
    } catch {
      // Fall back to the origin header below.
    }
  }

  const origin = req.headers.get("origin")?.trim();
  return (origin || "").replace(/\/$/, "");
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

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");

  if (!jwt) {
    return json({ error: "Authentication is required." }, 401);
  }

  const {
    data: { user: caller },
    error: callerError,
  } = await admin.auth.getUser(jwt);

  if (callerError || !caller) {
    return json({ error: "Authentication is invalid." }, 401);
  }

  const { data: callerProfile, error: profileError } = await admin
    .from("profiles")
    .select("status")
    .eq("id", caller.id)
    .single();

  if (profileError || callerProfile?.status !== "active") {
    return json({ error: "This account cannot manage users." }, 403);
  }

  if (caller.app_metadata?.role !== "admin") {
    return json({ error: "Admin role is required." }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const action = cleanText(body.action);

  if (action === "list") {
    const { data, error } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (error) return json({ error: error.message }, 400);

    const ids = data.users.map((item) => item.id);
    const { data: profiles } = ids.length
      ? await admin
          .from("profiles")
          .select("id,email,display_name,status")
          .in("id", ids)
      : { data: [] };

    const profileMap = new Map(
      (profiles ?? []).map((profile) => [profile.id, profile]),
    );

    return json({
      users: data.users.map((item) => {
        const profile = profileMap.get(item.id);
        return {
          id: item.id,
          email: item.email ?? profile?.email ?? "",
          displayName: profile?.display_name ?? null,
          role: cleanRole(item.app_metadata?.role),
          status: (profile?.status ?? "active") as Status,
          createdAt: item.created_at,
          lastSignInAt: item.last_sign_in_at ?? null,
        };
      }),
    });
  }

  if (action === "invite") {
    const email = cleanEmail(body.email);
    const displayName = cleanText(body.displayName) || email.split("@")[0];
    const role = cleanRole(body.role);

    if (!email || !email.includes("@")) {
      return json({ error: "Valid email is required." }, 400);
    }

    const redirectBase = siteUrl(req);
    const options = {
      data: { display_name: displayName },
      ...(redirectBase
        ? { redirectTo: `${redirectBase}/#/login?mode=set-password` }
        : {}),
    };

    const { data, error } = await admin.auth.admin.inviteUserByEmail(
      email,
      options,
    );

    if (error || !data.user) {
      return json({ error: error?.message ?? "Invite failed." }, 400);
    }

    const appMetadata = {
      ...data.user.app_metadata,
      role,
    };

    const { error: roleError } = await admin.auth.admin.updateUserById(
      data.user.id,
      { app_metadata: appMetadata },
    );

    if (roleError) return json({ error: roleError.message }, 400);

    await admin.from("profiles").upsert(
      {
        id: data.user.id,
        email,
        display_name: displayName,
        status: "active",
      },
      { onConflict: "id" },
    );

    return json({ ok: true });
  }

  if (action === "set-role") {
    const userId = cleanText(body.userId);
    const role = cleanRole(body.value);

    if (!userId) return json({ error: "User id is required." }, 400);
    if (userId === caller.id) {
      return json({ error: "You cannot change your own role here." }, 400);
    }

    const {
      data: { user: targetUser },
      error: targetError,
    } = await admin.auth.admin.getUserById(userId);

    if (targetError || !targetUser) {
      return json({ error: targetError?.message ?? "User not found." }, 404);
    }

    const { error } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: {
        ...targetUser.app_metadata,
        role,
      },
    });

    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === "set-status") {
    const userId = cleanText(body.userId);
    const status = cleanStatus(body.value);

    if (!userId || !status) {
      return json({ error: "Valid user id and status are required." }, 400);
    }

    if (userId === caller.id) {
      return json({ error: "You cannot disable your own account here." }, 400);
    }

    const { error } = await admin
      .from("profiles")
      .update({ status })
      .eq("id", userId);

    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "Unknown action." }, 400);
});
