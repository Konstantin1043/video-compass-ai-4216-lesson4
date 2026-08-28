import { createAnalysisStore, publicResult } from "../../lib/analysis-store.js";
import { errorResponse } from "../../lib/http.js";
import { languageFromAcceptLanguage, serverMessage } from "../../lib/language.js";
import { createAnalysisPdf } from "../../lib/pdf-export.js";
import { createSupabaseService, SupabaseError } from "../../lib/supabase.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createPdfHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async function pdf(request) {
    const language = languageFromAcceptLanguage(request.headers.get("accept-language"), "ru");
    if (request.method !== "GET") {
      return errorResponse(language, "METHOD_NOT_ALLOWED", 405, serverMessage, { headers: { Allow: "GET" } });
    }
    const jobId = new URL(request.url).searchParams.get("jobId") || "";
    if (!UUID_PATTERN.test(jobId)) return errorResponse(language, "INVALID_JOB_ID", 400, serverMessage);

    let active;
    try {
      const supabase = createSupabaseService({ env, fetchImpl });
      active = await supabase.resolveSession(request);
      if (!active) return errorResponse(language, "AUTH_REQUIRED", 401, serverMessage);
      const store = createAnalysisStore(supabase);
      const data = await store.getJob(active.user.id, jobId);
      if (!data || data.result.status !== "completed") {
        return errorResponse(language, "JOB_NOT_FOUND", 404, serverMessage, { cookies: active.cookies });
      }
      const pdfBuffer = await createAnalysisPdf(publicResult(data.result));
      const headers = new Headers({
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="videocompass-analysis.pdf"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      for (const cookie of active.cookies || []) headers.append("Set-Cookie", cookie);
      return new Response(pdfBuffer, { status: 200, headers });
    } catch (error) {
      const code = error instanceof SupabaseError ? error.code : "PDF_EXPORT_FAILED";
      const status = error instanceof SupabaseError ? error.status : 500;
      return errorResponse(language, code, status, serverMessage, { cookies: active?.cookies || [] });
    }
  };
}

const handler = createPdfHandler();
export const maxDuration = 30;
export default { fetch: (request) => handler(request) };

