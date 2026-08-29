import { createAnalysisStore, publicJob } from "../analysis-store.js";
import { fetchTranscript } from "../apify.js";
import { analyzeTranscriptStructured } from "../gemini.js";
import { errorResponse, jsonResponse, readJsonBody } from "../http.js";
import { languageFromAcceptLanguage, serverMessage } from "../language.js";
import { validateMutationRequest } from "../security.js";
import { PublicError } from "../service-error.js";
import { createSupabaseService, SupabaseError } from "../supabase.js";
import { prepareTranscriptData } from "../transcript.js";
import { fetchYouTubeMetadata } from "../youtube-metadata.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_STORED_TRANSCRIPT = 300_000;
const MAX_STORED_SEGMENTS = 10_000;
const MAX_STORED_SEGMENT_TEXT = 300_000;

function localized(language, code, status, options = {}) {
  return errorResponse(language, code, status, serverMessage, options);
}

function safeSegments(value) {
  const safe = [];
  let storedCharacters = 0;
  for (const segment of (Array.isArray(value) ? value : []).slice(0, MAX_STORED_SEGMENTS)) {
    const remaining = MAX_STORED_SEGMENT_TEXT - storedCharacters;
    if (remaining <= 0) break;
    const normalized = {
      text: String(segment?.text || "").slice(0, Math.min(2_000, remaining)),
      startMs: Number(segment?.startMs || 0),
      endMs: Number.isFinite(Number(segment?.endMs)) ? Number(segment.endMs) : null,
      startSeconds: Number(segment?.startSeconds || 0),
      startTimeText: String(segment?.startTimeText || "").slice(0, 16),
    };
    if (normalized.text && Number.isInteger(normalized.startSeconds) && normalized.startSeconds >= 0) {
      safe.push(normalized);
      storedCharacters += normalized.text.length;
    }
  }
  return safe;
}

export function createStepAnalysisHandler({
  env = process.env,
  fetchImpl = globalThis.fetch,
  supabaseService,
} = {}) {
  return async function stepAnalysis(request) {
    const headerLanguage = languageFromAcceptLanguage(request.headers.get("accept-language"), "ru");
    const securityError = validateMutationRequest(request);
    if (securityError) {
      return localized(
        headerLanguage,
        securityError,
        securityError === "METHOD_NOT_ALLOWED" ? 405 : securityError === "UNSUPPORTED_MEDIA_TYPE" ? 415 : 403,
        securityError === "METHOD_NOT_ALLOWED" ? { headers: { Allow: "POST" } } : {},
      );
    }

    const parsed = await readJsonBody(request, 1_024);
    if (parsed.error) return localized(headerLanguage, parsed.error, parsed.error === "BODY_TOO_LARGE" ? 413 : 400);
    if (!UUID_PATTERN.test(parsed.body?.jobId || "")) {
      return localized(headerLanguage, "INVALID_JOB_ID", 400);
    }
    if (
      !env.APIFY_API_TOKEN || !env.GEMINI_API_KEY || !env.SUPABASE_URL ||
      !env.SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_SECRET_KEY
    ) {
      return localized(headerLanguage, "SERVICE_NOT_CONFIGURED", 503);
    }

    let active;
    let store;
    let supabase;
    let jobData;
    let claimedStage = "";
    const startedAt = Date.now();
    try {
      supabase = supabaseService || createSupabaseService({ env, fetchImpl });
      store = createAnalysisStore(supabase);
      active = await supabase.resolveSession(request);
      if (!active) return localized(headerLanguage, "AUTH_REQUIRED", 401);

      jobData = await store.getJob(active.user.id, parsed.body.jobId);
      if (!jobData) return localized(headerLanguage, "JOB_NOT_FOUND", 404, { cookies: active.cookies });
      const language = jobData.result?.language || headerLanguage;
      if (["completed", "failed", "expired"].includes(jobData.result?.status)) {
        const credit = await supabase.creditStatus(active.accessToken);
        return jsonResponse({
          ok: true,
          job: publicJob(jobData.job, jobData.result),
          creditsRemaining: Number(credit?.credits_remaining ?? 0),
          nextResetAt: credit?.next_reset_at || null,
        }, 200, { cookies: active.cookies });
      }

      const claim = await supabase.serviceRpc("claim_analysis_stage", {
        p_result_id: jobData.result.id,
      });
      claimedStage = claim?.stage || "";
      if (!claim?.claimed) {
        const refreshed = await store.getJob(active.user.id, parsed.body.jobId);
        return jsonResponse({ ok: true, job: publicJob(refreshed.job, refreshed.result) }, 202, {
          cookies: active.cookies,
        });
      }

      if (claimedStage === "transcript_processing") {
        const [transcript, metadata] = await Promise.all([
          fetchTranscript(fetchImpl, env.APIFY_API_TOKEN, jobData.result.canonical_url),
          fetchYouTubeMetadata(
            fetchImpl,
            jobData.result.canonical_url,
            jobData.result.video_id,
          ),
        ]);
        const storedSegments = safeSegments(transcript.segments);
        const storedText = String(transcript.text || "").slice(0, MAX_STORED_TRANSCRIPT);
        const prepared = prepareTranscriptData({ text: storedText, segments: storedSegments });
        await supabase.serviceRpc("save_transcript_stage", {
          p_result_id: jobData.result.id,
          p_video_title: metadata.title,
          p_video_author: metadata.author,
          p_thumbnail_url: metadata.thumbnailUrl,
          p_transcript_text: storedText,
          p_transcript_segments: storedSegments,
          p_original_characters: String(transcript.text || "").length,
          p_sent_characters: prepared.sentCharacters,
          p_shortened:
            prepared.shortened ||
            String(transcript.text || "").length > MAX_STORED_TRANSCRIPT ||
            (transcript.segments?.length || 0) > MAX_STORED_SEGMENTS,
        });
      } else if (claimedStage === "ai_processing") {
        const refreshedResult = await store.getResult(jobData.result.id);
        const prepared = prepareTranscriptData({
          text: refreshedResult.transcript_text,
          segments: refreshedResult.transcript_segments,
        });
        const generated = await analyzeTranscriptStructured(
          fetchImpl,
          env.GEMINI_API_KEY,
          prepared,
          refreshedResult.language,
        );
        await supabase.serviceRpc("complete_analysis_stage", {
          p_result_id: refreshedResult.id,
          p_analysis: generated.analysis,
          p_analysis_text: generated.analysisText,
          p_model: generated.model,
        });
      }

      const refreshed = await store.getJob(active.user.id, parsed.body.jobId);
      const credit = await supabase.creditStatus(active.accessToken);
      console.info("[analysis:step] complete", {
        jobId: parsed.body.jobId,
        stage: claimedStage,
        durationMs: Date.now() - startedAt,
        status: refreshed.result.status,
      });
      return jsonResponse({
        ok: true,
        job: publicJob(refreshed.job, refreshed.result),
        creditsRemaining: Number(credit?.credits_remaining ?? 0),
        nextResetAt: credit?.next_reset_at || null,
      }, refreshed.result.status === "completed" ? 200 : 202, { cookies: active.cookies });
    } catch (error) {
      const code = error instanceof PublicError || error instanceof SupabaseError
        ? error.code
        : "UNEXPECTED_ERROR";
      if (claimedStage && jobData?.result?.id && supabase) {
        try {
          await supabase.serviceRpc("fail_analysis_stage", {
            p_result_id: jobData.result.id,
            p_error_code: code,
          });
        } catch {
          // The original failure remains the useful public signal.
        }
      }
      console.error("[analysis:step] failed", {
        jobId: parsed.body?.jobId || null,
        stage: claimedStage || null,
        durationMs: Date.now() - startedAt,
        errorCode: code,
      });
      const status = error instanceof PublicError || error instanceof SupabaseError
        ? error.status
        : 500;
      return localized(jobData?.result?.language || headerLanguage, code, status, {
        cookies: active?.cookies || [],
      });
    }
  };
}

const handler = createStepAnalysisHandler();
export const maxDuration = 90;
export default { fetch: (request) => handler(request) };
