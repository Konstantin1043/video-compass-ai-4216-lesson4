import { createAnalysisStore } from "../analysis-store.js";
import { errorResponse, jsonResponse, readJsonBody } from "../http.js";
import { languageFromAcceptLanguage, serverMessage } from "../language.js";
import { validateMutationRequest } from "../security.js";
import { createSupabaseService, SupabaseError } from "../supabase.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createHistoryHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async function history(request) {
    const language = languageFromAcceptLanguage(request.headers.get("accept-language"), "ru");
    if (!["GET", "PATCH", "DELETE"].includes(request.method)) {
      return errorResponse(language, "METHOD_NOT_ALLOWED", 405, serverMessage, {
        headers: { Allow: "GET, PATCH, DELETE" },
      });
    }
    if (request.method !== "GET") {
      const securityError = validateMutationRequest(request, { allowMethods: ["PATCH", "DELETE"] });
      if (securityError) {
        return errorResponse(language, securityError, securityError === "UNSUPPORTED_MEDIA_TYPE" ? 415 : 403, serverMessage);
      }
    }

    let active;
    try {
      const supabase = createSupabaseService({ env, fetchImpl });
      active = await supabase.resolveSession(request);
      if (!active) return errorResponse(language, "AUTH_REQUIRED", 401, serverMessage);
      const store = createAnalysisStore(supabase);

      if (request.method === "GET") {
        const items = await store.listHistory(active.user.id);
        return jsonResponse({ ok: true, items }, 200, { cookies: active.cookies });
      }

      const parsed = await readJsonBody(request, 1_024);
      if (parsed.error) return errorResponse(language, parsed.error, 400, serverMessage, { cookies: active.cookies });
      if (!UUID_PATTERN.test(parsed.body?.jobId || "")) {
        return errorResponse(language, "INVALID_JOB_ID", 400, serverMessage, { cookies: active.cookies });
      }

      if (request.method === "PATCH") {
        if (typeof parsed.body.favorite !== "boolean") {
          return errorResponse(language, "INVALID_BODY", 400, serverMessage, { cookies: active.cookies });
        }
        const updated = await store.setFavorite(active.user.id, parsed.body.jobId, parsed.body.favorite);
        if (!updated) return errorResponse(language, "JOB_NOT_FOUND", 404, serverMessage, { cookies: active.cookies });
        return jsonResponse({ ok: true, favorite: updated.favorite }, 200, { cookies: active.cookies });
      }

      const deleted = await store.deleteJob(active.user.id, parsed.body.jobId);
      if (!deleted) return errorResponse(language, "JOB_NOT_FOUND", 404, serverMessage, { cookies: active.cookies });
      await store.revokeShares(active.user.id, parsed.body.jobId);
      return jsonResponse({ ok: true }, 200, { cookies: active.cookies });
    } catch (error) {
      const code = error instanceof SupabaseError ? error.code : "UNEXPECTED_ERROR";
      const status = error instanceof SupabaseError ? error.status : 500;
      return errorResponse(language, code, status, serverMessage, { cookies: active?.cookies || [] });
    }
  };
}

const handler = createHistoryHandler();
export const maxDuration = 20;
export default { fetch: (request) => handler(request) };
