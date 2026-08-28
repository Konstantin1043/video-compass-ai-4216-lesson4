import { errorResponse, jsonResponse, readJsonBody } from "../../lib/http.js";
import { languageFromAcceptLanguage, serverMessage } from "../../lib/language.js";
import { consumeDatabaseRateLimit, validateMutationRequest } from "../../lib/security.js";
import { clearSessionCookies, createSupabaseService, SupabaseError } from "../../lib/supabase.js";

export function createDeleteAccountHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async function deleteAccount(request) {
    const language = languageFromAcceptLanguage(request.headers.get("accept-language"), "ru");
    const securityError = validateMutationRequest(request);
    if (securityError) {
      return errorResponse(language, securityError, securityError === "METHOD_NOT_ALLOWED" ? 405 : 403, serverMessage);
    }
    const parsed = await readJsonBody(request, 1_024);
    if (parsed.error) return errorResponse(language, parsed.error, 400, serverMessage);
    const password = typeof parsed.body?.password === "string" ? parsed.body.password : "";
    const captchaToken = typeof parsed.body?.captchaToken === "string"
      ? parsed.body.captchaToken.slice(0, 4_096)
      : "";
    if (password.length < 8 || password.length > 128) {
      return errorResponse(language, "INVALID_PASSWORD", 400, serverMessage);
    }

    let active;
    try {
      const supabase = createSupabaseService({ env, fetchImpl });
      active = await supabase.resolveSession(request);
      if (!active) return errorResponse(language, "AUTH_REQUIRED", 401, serverMessage);
      const limit = await consumeDatabaseRateLimit({
        request,
        supabase,
        env,
        scope: "account_delete",
        limit: 3,
        windowSeconds: 900,
        subject: active.user.id,
      });
      if (!limit.allowed) {
        return errorResponse(language, "TOO_MANY_REQUESTS", 429, serverMessage, {
          params: { seconds: limit.retryAfterSeconds },
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        });
      }

      if (env.TURNSTILE_REQUIRED === "true" && !captchaToken) {
        return errorResponse(language, "CAPTCHA_REQUIRED", 400, serverMessage, { cookies: active.cookies });
      }
      await supabase.login(active.user.email, password, captchaToken);
      await supabase.deleteUserAdmin(active.user.id);
      return jsonResponse({ ok: true, deleted: true }, 200, {
        cookies: clearSessionCookies(request),
      });
    } catch (error) {
      const code = error instanceof SupabaseError ? error.code : "UNEXPECTED_ERROR";
      const status = error instanceof SupabaseError ? error.status : 500;
      return errorResponse(language, code, status, serverMessage, { cookies: active?.cookies || [] });
    }
  };
}

const handler = createDeleteAccountHandler();
export const maxDuration = 25;
export default { fetch: (request) => handler(request) };
