const ACCESS_COOKIE = "vc_access";
const REFRESH_COOKIE = "vc_refresh";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export class SupabaseError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.name = "SupabaseError";
    this.code = code;
    this.status = status;
  }
}

export function hasSupabaseConfig(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);
}

function configuration(env) {
  if (!hasSupabaseConfig(env)) {
    throw new SupabaseError("SERVICE_NOT_CONFIGURED", 503);
  }

  let baseUrl;
  try {
    baseUrl = new URL(env.SUPABASE_URL);
  } catch {
    throw new SupabaseError("SERVICE_NOT_CONFIGURED", 503);
  }

  if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "127.0.0.1" && baseUrl.hostname !== "localhost") {
    throw new SupabaseError("SERVICE_NOT_CONFIGURED", 503);
  }

  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    apiKey: env.SUPABASE_PUBLISHABLE_KEY,
    secretKey: env.SUPABASE_SECRET_KEY || "",
  };
}

function parseCookies(header) {
  const cookies = new Map();
  for (const part of String(header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies.set(key, decodeURIComponent(value));
    } catch {
      cookies.set(key, value);
    }
  }
  return cookies;
}

function isSecureRequest(request) {
  return (
    request.headers.get("x-forwarded-proto") === "https" ||
    new URL(request.url).protocol === "https:"
  );
}

function cookie(name, value, { maxAge, secure }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function sessionCookies(request, session) {
  const secure = isSecureRequest(request);
  return [
    cookie(ACCESS_COOKIE, session.access_token, {
      maxAge: Number(session.expires_in) || 3_600,
      secure,
    }),
    cookie(REFRESH_COOKIE, session.refresh_token, {
      maxAge: THIRTY_DAYS,
      secure,
    }),
  ];
}

export function clearSessionCookies(request) {
  const secure = isSecureRequest(request);
  return [
    cookie(ACCESS_COOKIE, "", { maxAge: 0, secure }),
    cookie(REFRESH_COOKIE, "", { maxAge: 0, secure }),
  ];
}

async function readPayload(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function authErrorCode(payload, fallback) {
  const raw = `${payload?.error_code || ""} ${payload?.code || ""} ${payload?.msg || ""} ${payload?.message || ""}`.toLowerCase();
  if (raw.includes("invalid login") || raw.includes("invalid_credentials")) {
    return "INVALID_CREDENTIALS";
  }
  if (raw.includes("already registered") || raw.includes("user_already_exists")) {
    return "EMAIL_ALREADY_REGISTERED";
  }
  if (raw.includes("password") && (raw.includes("weak") || raw.includes("characters"))) {
    return "WEAK_PASSWORD";
  }
  if (raw.includes("rate limit") || raw.includes("over_email_send_rate_limit")) {
    return "AUTH_RATE_LIMIT";
  }
  if (raw.includes("captcha")) {
    return "CAPTCHA_FAILED";
  }
  return fallback;
}

export function createSupabaseService({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const { baseUrl, apiKey, secretKey } = configuration(env);

  async function authRequest(path, { method = "POST", body, accessToken } = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/auth/v1/${path}`, {
        method,
        headers: {
          apikey: apiKey,
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new SupabaseError("AUTH_TEMPORARY_ERROR", 503);
    }

    return { response, payload: await readPayload(response) };
  }

  async function register(email, password, captchaToken = "") {
    const { response, payload } = await authRequest("signup", {
      body: {
        email,
        password,
        ...(captchaToken
          ? { gotrue_meta_security: { captcha_token: captchaToken } }
          : {}),
      },
    });
    if (!response.ok) {
      throw new SupabaseError(authErrorCode(payload, "REGISTRATION_FAILED"), 400);
    }
    if (!payload?.access_token || !payload?.refresh_token || !payload?.user) {
      throw new SupabaseError("EMAIL_CONFIRMATION_ENABLED", 503);
    }
    return payload;
  }

  async function login(email, password, captchaToken = "") {
    const { response, payload } = await authRequest("token?grant_type=password", {
      body: {
        email,
        password,
        ...(captchaToken
          ? { gotrue_meta_security: { captcha_token: captchaToken } }
          : {}),
      },
    });
    if (!response.ok || !payload?.access_token || !payload?.refresh_token) {
      throw new SupabaseError(authErrorCode(payload, "INVALID_CREDENTIALS"), 401);
    }
    return payload;
  }

  async function refresh(refreshToken) {
    const { response, payload } = await authRequest("token?grant_type=refresh_token", {
      body: { refresh_token: refreshToken },
    });
    if (!response.ok || !payload?.access_token || !payload?.refresh_token) {
      return null;
    }
    return payload;
  }

  async function getUser(accessToken) {
    const { response, payload } = await authRequest("user", {
      method: "GET",
      accessToken,
    });
    return response.ok && payload?.id ? payload : null;
  }

  async function logout(accessToken) {
    if (!accessToken) return;
    try {
      await authRequest("logout", { accessToken });
    } catch {
      // Cookies are cleared even when Supabase is temporarily unreachable.
    }
  }

  async function resolveSession(request) {
    const cookies = parseCookies(request.headers.get("cookie"));
    const accessToken = cookies.get(ACCESS_COOKIE);
    const refreshToken = cookies.get(REFRESH_COOKIE);

    if (accessToken) {
      const user = await getUser(accessToken);
      if (user) {
        return { user, accessToken, refreshToken, cookies: [] };
      }
    }

    if (!refreshToken) return null;
    const refreshed = await refresh(refreshToken);
    if (!refreshed) return null;
    const user = refreshed.user || (await getUser(refreshed.access_token));
    if (!user) return null;
    return {
      user,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      cookies: sessionCookies(request, refreshed),
    };
  }

  async function rpc(name, accessToken, body = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new SupabaseError("DATABASE_TEMPORARY_ERROR", 503);
    }

    const payload = await readPayload(response);
    if (!response.ok) {
      const message = String(payload?.message || "");
      if (message.includes("NO_CREDITS")) throw new SupabaseError("NO_CREDITS", 403);
      if (message.includes("DUPLICATE_REQUEST")) throw new SupabaseError("DUPLICATE_REQUEST", 409);
      if (response.status === 401 || response.status === 403) {
        throw new SupabaseError("AUTH_REQUIRED", 401);
      }
      throw new SupabaseError("DATABASE_TEMPORARY_ERROR", 503);
    }

    return Array.isArray(payload) ? payload[0] : payload;
  }

  async function serviceRequest(path, {
    method = "GET",
    body,
    prefer,
    accessToken,
  } = {}) {
    if (!secretKey) {
      throw new SupabaseError("SERVICE_NOT_CONFIGURED", 503);
    }

    let response;
    try {
      response = await fetchImpl(`${baseUrl}/${path.replace(/^\//, "")}`, {
        method,
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${accessToken || secretKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(prefer ? { Prefer: prefer } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new SupabaseError("DATABASE_TEMPORARY_ERROR", 503);
    }

    const payload = response.status === 204 ? null : await readPayload(response);
    if (!response.ok) {
      console.error("[supabase] service request failed", {
        path: path.split("?")[0],
        status: response.status,
        code: payload?.code || null,
      });
      throw new SupabaseError(
        response.status === 404
          ? "NOT_FOUND"
          : response.status === 409
            ? "DATABASE_CONFLICT"
            : "DATABASE_TEMPORARY_ERROR",
        response.status === 404 ? 404 : response.status === 409 ? 409 : 503,
      );
    }
    return payload;
  }

  async function serviceRpc(name, body = {}) {
    const payload = await serviceRequest(`rest/v1/rpc/${name}`, {
      method: "POST",
      body,
    });
    return Array.isArray(payload) ? payload[0] : payload;
  }

  async function deleteUserAdmin(userId) {
    await serviceRequest(`auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
  }

  return {
    register,
    login,
    logout,
    resolveSession,
    creditStatus: (token) => rpc("get_credit_status", token),
    reserveCredit: (token, requestId, videoId, language) =>
      rpc("reserve_analysis_credit", token, {
        p_request_id: requestId,
        p_video_id: videoId,
        p_language: language,
      }),
    commitCredit: (token, requestId) =>
      rpc("commit_analysis_credit", token, { p_request_id: requestId }),
    refundCredit: (token, requestId) =>
      rpc("refund_analysis_credit", token, { p_request_id: requestId }),
    serviceRequest,
    serviceRpc,
    deleteUserAdmin,
  };
}
