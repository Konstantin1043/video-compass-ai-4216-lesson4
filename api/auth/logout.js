import {
  clearSessionCookies,
  createSupabaseService,
  errorResponse,
  jsonResponse,
  requestLanguage,
  serverMessage,
} from "./helpers.js";

export function createLogoutHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async function logout(request) {
    const language = requestLanguage(request);
    if (request.method !== "POST") {
      return errorResponse(language, "METHOD_NOT_ALLOWED", 405, serverMessage, {
        headers: { Allow: "POST" },
      });
    }

    try {
      const supabase = createSupabaseService({ env, fetchImpl });
      const active = await supabase.resolveSession(request);
      await supabase.logout(active?.accessToken);
    } catch {
      // Local cookies are always cleared, including during a temporary outage.
    }

    return jsonResponse(
      { ok: true, authenticated: false },
      200,
      { cookies: clearSessionCookies(request) },
    );
  };
}

const handler = createLogoutHandler();
export default { fetch: (request) => handler(request) };
