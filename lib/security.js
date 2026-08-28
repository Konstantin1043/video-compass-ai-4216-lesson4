import { createHmac } from "node:crypto";

export function clientAddress(request) {
  return (
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  );
}

export function requestFingerprint(request, secret, suffix = "") {
  if (!secret) return null;
  return createHmac("sha256", secret)
    .update(`${clientAddress(request)}:${suffix}`)
    .digest("hex");
}

export function validateMutationRequest(request, { allowMethods = ["POST"] } = {}) {
  if (!allowMethods.includes(request.method)) return "METHOD_NOT_ALLOWED";

  const type = request.headers.get("content-type") || "";
  if (request.method !== "DELETE" && !type.toLowerCase().startsWith("application/json")) {
    return "UNSUPPORTED_MEDIA_TYPE";
  }

  const fetchSite = (request.headers.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return "CROSS_SITE_REQUEST";
  }

  const origin = request.headers.get("origin");
  if (origin) {
    let requestOrigin;
    try {
      requestOrigin = new URL(request.url).origin;
    } catch {
      return "CROSS_SITE_REQUEST";
    }
    if (origin !== requestOrigin) return "CROSS_SITE_REQUEST";
  }

  return null;
}

export async function consumeDatabaseRateLimit({
  request,
  supabase,
  env = process.env,
  scope,
  limit,
  windowSeconds,
  subject = "",
}) {
  if (!env.RATE_LIMIT_SECRET || !env.SUPABASE_SECRET_KEY) {
    return { allowed: true, retryAfterSeconds: 0, configured: false };
  }

  const keyHash = requestFingerprint(request, env.RATE_LIMIT_SECRET, subject);
  const result = await supabase.serviceRpc("consume_rate_limit", {
    p_scope: scope,
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  return {
    allowed: Boolean(result?.allowed),
    retryAfterSeconds: Number(result?.retry_after_seconds || 0),
    configured: true,
  };
}

