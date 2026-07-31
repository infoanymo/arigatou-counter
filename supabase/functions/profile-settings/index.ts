import { createClient } from "npm:@supabase/supabase-js@2.111.0";

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

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanAvatarUrl(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  if (text.startsWith("data:image/") || text.startsWith("https://")) return text;
  return null;
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
    data: { user },
    error: userError,
  } = await admin.auth.getUser(jwt);

  if (userError || !user) {
    return json({ error: "Authentication is invalid." }, 401);
  }

  const body = await req.json().catch(() => ({}));
  if (cleanText(body.action) !== "update") {
    return json({ error: "Unknown action." }, 400);
  }

  const displayName = cleanText(body.displayName);
  const companyName = cleanText(body.companyName) || null;
  const avatarUrl = cleanAvatarUrl(body.avatarUrl);

  if (!displayName) {
    return json({ error: "Display name is required." }, 400);
  }

  if (avatarUrl && avatarUrl.length > 600_000) {
    return json({ error: "Avatar image is too large." }, 400);
  }

  const { data: currentProfile, error: profileError } = await admin
    .from("profiles")
    .select("status,email")
    .eq("id", user.id)
    .single();

  if (profileError || currentProfile?.status !== "active") {
    return json({ error: "This account cannot update profile." }, 403);
  }

  const { error: authError } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...user.user_metadata,
      display_name: displayName,
      company_name: companyName,
    },
  });

  if (authError) return json({ error: authError.message }, 400);

  const { data: profile, error } = await admin
    .from("profiles")
    .update({
      display_name: displayName,
      company_name: companyName,
      avatar_url: avatarUrl,
    })
    .eq("id", user.id)
    .select("id,email,display_name,company_name,avatar_url,status,created_at,updated_at")
    .single();

  if (error) return json({ error: error.message }, 400);
  return json({ profile });
});
