import {
  clearSessionCookies,
  createSupabaseService,
  errorResponse,
  jsonResponse,
  requestLanguage,
  serverMessage,
} from "./helpers.js";
import { validateMutationRequest } from "../../lib/security.js";

export function createLogoutHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async function logout(request) {
    const language = requestLanguage(request);
    const securityError = validateMutationRequest(request);
    if (securityError) {
      return errorResponse(language, securityError, securityError === "METHOD_NOT_ALLOWED" ? 405 : securityError === "UNSUPPORTED_MEDIA_TYPE" ? 415 : 403, serverMessage, {
        ...(securityError === "METHOD_NOT_ALLOWED" ? { headers: { Allow: "POST" } } : {}),
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
