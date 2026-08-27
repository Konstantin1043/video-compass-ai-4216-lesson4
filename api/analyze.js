import { fetchTranscript } from "../lib/apify.js";
import { analyzeTranscript } from "../lib/gemini.js";
import { errorResponse, jsonResponse, readJsonBody } from "../lib/http.js";
import {
  isSupportedLanguage,
  languageFromAcceptLanguage,
  serverMessage,
} from "../lib/language.js";
import { PublicError } from "../lib/service-error.js";
import { sanitizeAnalysisTimecodes } from "../lib/timecodes.js";
import {
  createSupabaseService,
  SupabaseError,
} from "../lib/supabase.js";
import { prepareTranscriptData } from "../lib/transcript.js";
import { parseYouTubeUrl } from "../lib/youtube.js";

const MAX_BODY_CHARACTERS = 2_048;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function localizedError(language, code, status, options = {}) {
  return errorResponse(language, code, status, serverMessage, options);
}

function getClientAddress(request) {
  return (
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  );
}

export function createRateLimiter({ limit = 3, windowMs = 60_000, now = Date.now } = {}) {
  const clients = new Map();

  return {
    consume(key) {
      const currentTime = now();
      const active = (clients.get(key) || []).filter(
        (timestamp) => currentTime - timestamp < windowMs,
      );

      if (active.length >= limit) {
        const retryAfterMs = windowMs - (currentTime - active[0]);
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1_000)),
        };
      }

      active.push(currentTime);
      clients.set(key, active);

      if (clients.size > 500) {
        for (const [clientKey, timestamps] of clients) {
          if (timestamps.every((timestamp) => currentTime - timestamp >= windowMs)) {
            clients.delete(clientKey);
          }
        }
      }

      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

export function createAnalyzeHandler({
  env = process.env,
  fetchImpl = globalThis.fetch,
  rateLimiter = createRateLimiter(),
  supabaseService,
} = {}) {
  return async function handleAnalyze(request) {
    const headerLanguage = languageFromAcceptLanguage(
      request.headers.get("accept-language"),
      "ru",
    );

    if (request.method !== "POST") {
      return localizedError(
        headerLanguage,
        "METHOD_NOT_ALLOWED",
        405,
        { headers: { Allow: "POST" } },
      );
    }

    const rateResult = rateLimiter.consume(getClientAddress(request));
    if (!rateResult.allowed) {
      return localizedError(
        headerLanguage,
        "TOO_MANY_REQUESTS",
        429,
        {
          params: { seconds: rateResult.retryAfterSeconds },
          headers: { "Retry-After": String(rateResult.retryAfterSeconds) },
        },
      );
    }

    const parsed = await readJsonBody(request, MAX_BODY_CHARACTERS);
    if (parsed.error) {
      return localizedError(
        headerLanguage,
        parsed.error,
        parsed.error === "BODY_TOO_LARGE" ? 413 : 400,
      );
    }
    const body = parsed.body;

    if (body?.language !== undefined && !isSupportedLanguage(body.language)) {
      return localizedError(headerLanguage, "UNSUPPORTED_LANGUAGE", 400);
    }

    const language = body?.language || "ru";
    const video = parseYouTubeUrl(body?.youtubeUrl);
    if (!video) {
      return localizedError(language, "INVALID_YOUTUBE_URL", 400);
    }

    if (!UUID_PATTERN.test(body?.requestId || "")) {
      return localizedError(language, "INVALID_REQUEST_ID", 400);
    }

    if (
      !env.APIFY_API_TOKEN ||
      !env.GEMINI_API_KEY ||
      (!supabaseService && (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY))
    ) {
      return localizedError(language, "SERVICE_NOT_CONFIGURED", 503);
    }

    let supabase;
    let active;
    try {
      supabase = supabaseService || createSupabaseService({ env, fetchImpl });
      active = await supabase.resolveSession(request);
      if (!active) {
        return localizedError(language, "AUTH_REQUIRED", 401);
      }
      await supabase.reserveCredit(
        active.accessToken,
        body.requestId,
        video.videoId,
        language,
      );
    } catch (error) {
      if (error instanceof SupabaseError) {
        return localizedError(language, error.code, error.status, {
          cookies: active?.cookies || [],
        });
      }
      return localizedError(language, "AUTH_TEMPORARY_ERROR", 503);
    }

    try {
      const transcript = await fetchTranscript(
        fetchImpl,
        env.APIFY_API_TOKEN,
        video.canonicalUrl,
      );
      const preparedTranscript = prepareTranscriptData(transcript);
      const rawAnalysis = await analyzeTranscript(
        fetchImpl,
        env.GEMINI_API_KEY,
        preparedTranscript,
        language,
      );
      const analysis = sanitizeAnalysisTimecodes(
        rawAnalysis,
        preparedTranscript.allowedTimestampSeconds,
        language,
      );
      const credit = await supabase.commitCredit(active.accessToken, body.requestId);

      return jsonResponse(
        {
          ok: true,
          language,
          video,
          analysis,
          creditsRemaining: Number(credit?.credits_remaining ?? 0),
          nextResetAt: credit?.next_reset_at || null,
          transcript: {
            originalCharacters: preparedTranscript.originalCharacters,
            sentCharacters: preparedTranscript.sentCharacters,
            shortened: preparedTranscript.shortened,
          },
        },
        200,
        { cookies: active.cookies || [] },
      );
    } catch (error) {
      try {
        await supabase.refundCredit(active.accessToken, body.requestId);
      } catch {
        // The original public error remains more useful than a secondary refund error.
      }

      if (error instanceof PublicError) {
        return localizedError(language, error.code, error.status, {
          cookies: active.cookies || [],
        });
      }
      if (error instanceof SupabaseError) {
        return localizedError(language, error.code, error.status, {
          cookies: active.cookies || [],
        });
      }

      return localizedError(language, "UNEXPECTED_ERROR", 500, {
        cookies: active.cookies || [],
      });
    }
  };
}

const handler = createAnalyzeHandler();

export const maxDuration = 120;

export default {
  fetch(request) {
    return handler(request);
  },
};
