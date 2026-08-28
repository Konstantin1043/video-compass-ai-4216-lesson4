import { createAnalysisStore, publicJob } from "../../lib/analysis-store.js";
import { errorResponse, jsonResponse } from "../../lib/http.js";
import { languageFromAcceptLanguage, serverMessage } from "../../lib/language.js";
import { createSupabaseService, SupabaseError } from "../../lib/supabase.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createStatusHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async function status(request) {
    const language = languageFromAcceptLanguage(request.headers.get("accept-language"), "ru");
    if (request.method !== "GET") {
      return errorResponse(language, "METHOD_NOT_ALLOWED", 405, serverMessage, {
        headers: { Allow: "GET" },
      });
    }
    const jobId = new URL(request.url).searchParams.get("jobId");
    if (!UUID_PATTERN.test(jobId || "")) {
      return errorResponse(language, "INVALID_JOB_ID", 400, serverMessage);
    }

    let active;
    try {
      const supabase = createSupabaseService({ env, fetchImpl });
      active = await supabase.resolveSession(request);
      if (!active) return errorResponse(language, "AUTH_REQUIRED", 401, serverMessage);
      const store = createAnalysisStore(supabase);
      const data = await store.getJob(active.user.id, jobId);
      if (!data) return errorResponse(language, "JOB_NOT_FOUND", 404, serverMessage, { cookies: active.cookies });
      if (data.result.status === "completed") await store.touchResult(data.result.id);
      const credit = await supabase.creditStatus(active.accessToken);
      const job = publicJob(data.job, data.result);
      if (job.errorCode) job.errorMessage = serverMessage(data.result.language, job.errorCode);
      return jsonResponse({
        ok: true,
        job,
        creditsRemaining: Number(credit?.credits_remaining ?? 0),
        nextResetAt: credit?.next_reset_at || null,
      }, 200, { cookies: active.cookies });
    } catch (error) {
      const code = error instanceof SupabaseError ? error.code : "UNEXPECTED_ERROR";
      const statusCode = error instanceof SupabaseError ? error.status : 500;
      return errorResponse(language, code, statusCode, serverMessage, { cookies: active?.cookies || [] });
    }
  };
}

const handler = createStatusHandler();
export const maxDuration = 20;
export default { fetch: (request) => handler(request) };

