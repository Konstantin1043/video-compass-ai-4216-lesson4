import {
  authErrorResponse,
  clearSessionCookies,
  createSupabaseService,
  errorResponse,
  jsonResponse,
  publicUser,
  requestLanguage,
  serverMessage,
} from "./helpers.js";

export function createSessionHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async function session(request) {
    const language = requestLanguage(request);
    if (request.method !== "GET") {
      return errorResponse(language, "METHOD_NOT_ALLOWED", 405, serverMessage, {
        headers: { Allow: "GET" },
      });
    }

    try {
      const supabase = createSupabaseService({ env, fetchImpl });
      const active = await supabase.resolveSession(request);
      if (!active) {
        return jsonResponse(
          { ok: true, authenticated: false },
          200,
          { cookies: clearSessionCookies(request) },
        );
      }
      const credit = await supabase.creditStatus(active.accessToken);
      return jsonResponse(
        { ok: true, authenticated: true, user: publicUser(active.user, credit) },
        200,
        { cookies: active.cookies },
      );
    } catch (error) {
      return authErrorResponse(language, error, request);
    }
  };
}

const handler = createSessionHandler();
export default { fetch: (request) => handler(request) };
