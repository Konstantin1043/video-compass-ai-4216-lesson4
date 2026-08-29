import {
  authErrorResponse,
  createSupabaseService,
  credentialsBody,
  errorResponse,
  jsonResponse,
  publicUser,
  requestLanguage,
  serverMessage,
  sessionCookies,
  validateCredentials,
} from "../../lib/auth-helpers.js";
import { consumeDatabaseRateLimit, validateMutationRequest } from "../../lib/security.js";

export function createRegisterHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async function register(request) {
    const headerLanguage = requestLanguage(request);
    const securityError = validateMutationRequest(request);
    if (securityError) {
      return errorResponse(headerLanguage, securityError, securityError === "METHOD_NOT_ALLOWED" ? 405 : securityError === "UNSUPPORTED_MEDIA_TYPE" ? 415 : 403, serverMessage, {
        ...(securityError === "METHOD_NOT_ALLOWED" ? { headers: { Allow: "POST" } } : {}),
      });
    }

    const parsed = await credentialsBody(request);
    if (parsed.error) {
      return errorResponse(headerLanguage, parsed.error, parsed.error === "BODY_TOO_LARGE" ? 413 : 400, serverMessage);
    }
    const language = requestLanguage(request, parsed.body);
    const credentials = validateCredentials(parsed.body);
    if (credentials.error) {
      return errorResponse(language, credentials.error, 400, serverMessage);
    }
    const captchaToken = typeof parsed.body?.captchaToken === "string" ? parsed.body.captchaToken : "";
    if (env.TURNSTILE_REQUIRED === "true" && !captchaToken) {
      return errorResponse(language, "CAPTCHA_REQUIRED", 400, serverMessage);
    }

    try {
      const supabase = createSupabaseService({ env, fetchImpl });
      const limit = await consumeDatabaseRateLimit({
        request, supabase, env, scope: "signup", limit: 5, windowSeconds: 3600,
      });
      if (!limit.allowed) {
        return errorResponse(language, "TOO_MANY_REQUESTS", 429, serverMessage, {
          params: { seconds: limit.retryAfterSeconds },
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        });
      }
      const session = await supabase.register(credentials.email, credentials.password, captchaToken);
      const credit = await supabase.creditStatus(session.access_token);
      return jsonResponse(
        { ok: true, authenticated: true, user: publicUser(session.user, credit) },
        201,
        { cookies: sessionCookies(request, session) },
      );
    } catch (error) {
      return authErrorResponse(language, error, request);
    }
  };
}

const handler = createRegisterHandler();
export default { fetch: (request) => handler(request) };
