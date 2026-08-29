import { analysisCacheKey, createAnalysisStore, publicJob } from "../analysis-store.js";
import { errorResponse, jsonResponse, readJsonBody } from "../http.js";
import { isSupportedLanguage, languageFromAcceptLanguage, serverMessage } from "../language.js";
import { consumeDatabaseRateLimit, validateMutationRequest } from "../security.js";
import { createSupabaseService, SupabaseError } from "../supabase.js";
import { parseYouTubeUrl } from "../youtube.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CACHE_MS = 24 * 60 * 60 * 1_000;

function localized(language, code, status, options = {}) {
  return errorResponse(language, code, status, serverMessage, options);
}

function dailyLimit(env) {
  const configured = Number(env.MAX_EXTERNAL_ANALYSES_PER_DAY || 100);
  return Number.isInteger(configured) && configured >= 1 && configured <= 500
    ? configured
    : 100;
}

function monthlyLimit(env) {
  const configured = Number(env.MAX_EXTERNAL_ANALYSES_PER_MONTH || 1_000);
  return Number.isInteger(configured) && configured >= 1 && configured <= 10_000
    ? configured
    : 1_000;
}

export function createStartAnalysisHandler({
  env = process.env,
  fetchImpl = globalThis.fetch,
  supabaseService,
} = {}) {
  return async function startAnalysis(request) {
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

    const parsed = await readJsonBody(request, 2_048);
    if (parsed.error) return localized(headerLanguage, parsed.error, parsed.error === "BODY_TOO_LARGE" ? 413 : 400);
    const body = parsed.body;
    if (body?.language !== undefined && !isSupportedLanguage(body.language)) {
      return localized(headerLanguage, "UNSUPPORTED_LANGUAGE", 400);
    }
    const language = body?.language || "ru";
    const video = parseYouTubeUrl(body?.youtubeUrl);
    if (!video) return localized(language, "INVALID_YOUTUBE_URL", 400);
    if (!UUID_PATTERN.test(body?.requestId || "")) {
      return localized(language, "INVALID_REQUEST_ID", 400);
    }
    if (
      !env.APIFY_API_TOKEN ||
      !env.GEMINI_API_KEY ||
      !env.SUPABASE_URL ||
      !env.SUPABASE_PUBLISHABLE_KEY ||
      !env.SUPABASE_SECRET_KEY
    ) {
      return localized(language, "SERVICE_NOT_CONFIGURED", 503);
    }

    let active;
    try {
      const supabase = supabaseService || createSupabaseService({ env, fetchImpl });
      const store = createAnalysisStore(supabase);
      active = await supabase.resolveSession(request);
      if (!active) return localized(language, "AUTH_REQUIRED", 401);

      const limit = await consumeDatabaseRateLimit({
        request,
        supabase,
        env,
        scope: "analysis_start",
        limit: 3,
        windowSeconds: 60,
        subject: active.user.id,
      });
      if (!limit.allowed) {
        return localized(language, "TOO_MANY_REQUESTS", 429, {
          params: { seconds: limit.retryAfterSeconds },
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
          cookies: active.cookies,
        });
      }

      const existingRequest = await store.findJobByRequest(active.user.id, body.requestId);
      if (existingRequest) {
        const result = await store.getResult(existingRequest.result_id);
        const credit = await supabase.creditStatus(active.accessToken);
        return jsonResponse({
          ok: true,
          job: publicJob(existingRequest, result),
          creditsRemaining: Number(credit?.credits_remaining ?? 0),
          nextResetAt: credit?.next_reset_at || null,
        }, 200, { cookies: active.cookies });
      }

      const cacheKey = analysisCacheKey(video.videoId, language);
      const activeUserJob = await store.findActiveUserJob(active.user.id, cacheKey);
      if (activeUserJob) {
        const result = await store.getResult(activeUserJob.result_id);
        const credit = await supabase.creditStatus(active.accessToken);
        return jsonResponse({
          ok: true,
          job: publicJob(activeUserJob, result),
          creditsRemaining: Number(credit?.credits_remaining ?? 0),
          nextResetAt: credit?.next_reset_at || null,
        }, 200, { cookies: active.cookies });
      }

      const cached = await store.findResultByCache(cacheKey);
      const isFreshCache = cached?.status === "completed" &&
        cached.completed_at && Date.now() - Date.parse(cached.completed_at) <= CACHE_MS;
      const activeShared = await store.findActiveResultByCache(cacheKey);

      if (isFreshCache || activeShared) {
        const result = isFreshCache ? cached : activeShared;
        const job = await store.createJob({
          request_id: body.requestId,
          user_id: active.user.id,
          result_id: result.id,
          status: result.status,
          credit_reserved: false,
          cache_hit: isFreshCache,
          completed_at: isFreshCache ? result.completed_at : null,
        });
        if (isFreshCache) await store.touchResult(result.id);
        const credit = await supabase.creditStatus(active.accessToken);
        return jsonResponse({
          ok: true,
          job: publicJob(job, result),
          creditsRemaining: Number(credit?.credits_remaining ?? 0),
          nextResetAt: credit?.next_reset_at || null,
        }, 200, { cookies: active.cookies });
      }

      const now = new Date();
      const today = new Date(now);
      today.setUTCHours(0, 0, 0, 0);
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const [usedToday, usedThisMonth] = await Promise.all([
        store.countExternalAnalysesSince(today.toISOString()),
        store.countExternalAnalysesSince(month.toISOString()),
      ]);
      if (usedToday >= dailyLimit(env) || usedThisMonth >= monthlyLimit(env)) {
        return localized(language, "COST_GUARD_REACHED", 429, { cookies: active.cookies });
      }

      await supabase.reserveCredit(active.accessToken, body.requestId, video.videoId, language);
      let resultInfo;
      try {
        resultInfo = await store.createOrReuseResult({
          cache_key: cacheKey,
          video_id: video.videoId,
          canonical_url: video.canonicalUrl,
          thumbnail_url: video.thumbnailUrl,
          language,
          model: store.model,
          prompt_version: store.promptVersion,
          status: "queued",
        });
      } catch (error) {
        await supabase.refundCredit(active.accessToken, body.requestId);
        throw error;
      }

      const charged = Boolean(resultInfo?.created);
      if (!charged) await supabase.refundCredit(active.accessToken, body.requestId);
      const result = resultInfo?.result;
      if (!result) throw new SupabaseError("DATABASE_TEMPORARY_ERROR", 503);

      let job;
      try {
        job = await store.createJob({
          request_id: body.requestId,
          user_id: active.user.id,
          result_id: result.id,
          status: result.status,
          credit_reserved: charged,
          cache_hit: false,
        });
      } catch (error) {
        if (charged) await supabase.refundCredit(active.accessToken, body.requestId);
        throw error;
      }

      const credit = await supabase.creditStatus(active.accessToken);
      return jsonResponse({
        ok: true,
        job: publicJob(job, result),
        creditsRemaining: Number(credit?.credits_remaining ?? 0),
        nextResetAt: credit?.next_reset_at || null,
      }, 201, { cookies: active.cookies });
    } catch (error) {
      if (error instanceof SupabaseError) {
        return localized(headerLanguage, error.code, error.status, { cookies: active?.cookies || [] });
      }
      console.error("[analysis:start] unexpected", { name: error?.name || "Error" });
      return localized(headerLanguage, "UNEXPECTED_ERROR", 500, { cookies: active?.cookies || [] });
    }
  };
}

const handler = createStartAnalysisHandler();
export const maxDuration = 25;
export default { fetch: (request) => handler(request) };
