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
} from "./helpers.js";

export function createRegisterHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async function register(request) {
    const headerLanguage = requestLanguage(request);
    if (request.method !== "POST") {
      return errorResponse(headerLanguage, "METHOD_NOT_ALLOWED", 405, serverMessage, {
        headers: { Allow: "POST" },
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

    try {
      const supabase = createSupabaseService({ env, fetchImpl });
      const session = await supabase.register(credentials.email, credentials.password);
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
