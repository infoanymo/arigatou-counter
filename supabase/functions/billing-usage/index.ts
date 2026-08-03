import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Price = {
  amount?: number;
  description?: string;
  interval?: string;
  type?: string;
};

type Addon = {
  type?: string;
  variant?: {
    id?: string;
    name?: string;
    price?: Price;
  };
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

function projectRefFromUrl(supabaseUrl: string) {
  try {
    return new URL(supabaseUrl).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

function monthlyPrice(price: Price | undefined) {
  if (typeof price?.amount !== "number") return 0;
  if (price.interval === "hourly") return price.amount * 730;
  if (price.interval === "monthly") return price.amount;
  return 0;
}

function formatManagementError(status: number, body: unknown) {
  if (body && typeof body === "object" && "message" in body) {
    return `${status}: ${String((body as { message?: unknown }).message)}`;
  }
  if (body && typeof body === "object" && "error" in body) {
    return `${status}: ${String((body as { error?: unknown }).error)}`;
  }
  return `${status}: Supabase Management API request failed.`;
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
    return json({ error: "This account cannot view billing usage." }, 403);
  }

  if (caller.app_metadata?.role !== "admin") {
    return json({ error: "Admin role is required." }, 403);
  }

  const managementToken =
    Deno.env.get("SUPABASE_ACCESS_TOKEN")?.trim() ||
    Deno.env.get("SUPABASE_MANAGEMENT_API_TOKEN")?.trim();
  const projectRef =
    Deno.env.get("SUPABASE_PROJECT_REF")?.trim() || projectRefFromUrl(supabaseUrl);

  if (!managementToken || !projectRef) {
    return json({
      live: false,
      generatedAt: new Date().toISOString(),
      missing: [
        !managementToken ? "SUPABASE_ACCESS_TOKEN" : null,
        !projectRef ? "SUPABASE_PROJECT_REF" : null,
      ].filter(Boolean),
      message:
        "Supabase Management APIの接続情報が未設定のため、実使用量を取得できません。",
    });
  }

  const warnings: string[] = [];

  async function managementGet(path: string) {
    const response = await fetch(`https://api.supabase.com${path}`, {
      headers: {
        Authorization: `Bearer ${managementToken}`,
        Accept: "application/json",
      },
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(formatManagementError(response.status, data));
    }

    return data;
  }

  try {
    const project = await managementGet(`/v1/projects/${projectRef}`);
    let organization = null;
    let addons: { selected_addons?: Addon[] } = {};
    let requestCount = null;
    let apiCounts = null;

    if (project?.organization_slug) {
      try {
        organization = await managementGet(
          `/v1/organizations/${project.organization_slug}`,
        );
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? `Organization: ${error.message}`
            : "Organization usage could not be loaded.",
        );
      }
    }

    try {
      addons = await managementGet(`/v1/projects/${projectRef}/billing/addons`);
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? `Billing addons: ${error.message}`
          : "Billing addons could not be loaded.",
      );
    }

    try {
      requestCount = await managementGet(
        `/v1/projects/${projectRef}/analytics/endpoints/usage.api-requests-count`,
      );
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? `API requests: ${error.message}`
          : "API requests could not be loaded.",
      );
    }

    try {
      apiCounts = await managementGet(
        `/v1/projects/${projectRef}/analytics/endpoints/usage.api-counts?interval=1day`,
      );
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? `API breakdown: ${error.message}`
          : "API breakdown could not be loaded.",
      );
    }

    const selectedAddons = addons.selected_addons ?? [];
    const selectedAddonTotal = selectedAddons.reduce(
      (sum, item) => sum + monthlyPrice(item.variant?.price),
      0,
    );

    return json({
      live: true,
      generatedAt: new Date().toISOString(),
      project: {
        ref: project.ref,
        name: project.name,
        region: project.region,
        status: project.status,
        organizationSlug: project.organization_slug,
      },
      organization: organization
        ? {
            name: organization.name,
            slug: organization.slug,
            plan: organization.plan,
          }
        : null,
      billingPageUrl: project.organization_slug
        ? `https://supabase.com/dashboard/org/${project.organization_slug}/billing`
        : "https://supabase.com/dashboard",
      usagePageUrl: project.organization_slug
        ? `https://supabase.com/dashboard/org/${project.organization_slug}/usage`
        : "https://supabase.com/dashboard",
      selectedAddons: selectedAddons.map((item) => ({
        type: item.type ?? "unknown",
        variantId: item.variant?.id ?? "",
        name: item.variant?.name ?? item.type ?? "Add-on",
        price: item.variant?.price ?? null,
        estimatedMonthlyUsd: monthlyPrice(item.variant?.price),
      })),
      selectedAddonEstimatedMonthlyUsd: selectedAddonTotal,
      apiRequestCount: requestCount?.result?.[0]?.count ?? null,
      apiCounts: apiCounts?.result ?? [],
      warnings,
    });
  } catch (error) {
    return json(
      {
        live: false,
        generatedAt: new Date().toISOString(),
        message:
          error instanceof Error
            ? error.message
            : "Supabase Management API usage could not be loaded.",
      },
      200,
    );
  }
});
