import { buildAnalysisPrompt, buildStructuredAnalysisPrompt } from "./prompt.js";
import { PublicError, fetchWithTimeout } from "./service-error.js";
import {
  normalizeStructuredAnalysis,
  STRUCTURED_ANALYSIS_SCHEMA,
  structuredAnalysisToText,
} from "./structured-analysis.js";

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_FALLBACK_MODEL = "gemini-3.1-flash-lite";
const GEMINI_ATTEMPTS = 2;
const GEMINI_TOTAL_TIMEOUT_MS = 50_000;
const GEMINI_ATTEMPT_TIMEOUT_MS = 30_000;
const GEMINI_RETRY_DELAY_MS = 500;

function endpointFor(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function extractGeminiText(payload) {
  const candidateText = payload?.candidates
    ?.flatMap((candidate) => candidate?.content?.parts || [])
    .filter((part) => typeof part?.text === "string")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (candidateText) {
    return candidateText;
  }

  if (typeof payload?.output_text === "string") {
    return payload.output_text.trim();
  }

  if (!Array.isArray(payload?.steps)) {
    return "";
  }

  return payload.steps
    .filter((step) => step?.type === "model_output" && Array.isArray(step.content))
    .flatMap((step) => step.content)
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

async function logGeminiFailure(response) {
  let apiError = {};

  try {
    const payload = await response.json();
    if (payload?.error && typeof payload.error === "object") {
      apiError = payload.error;
    }
  } catch {
    // The HTTP status is still useful when Google returns a non-JSON response.
  }

  const message =
    typeof apiError.message === "string" ? apiError.message.slice(0, 500) : undefined;

  console.error("[gemini] request failed", {
    httpStatus: response.status,
    apiCode: apiError.code,
    apiStatus: apiError.status,
    message,
  });
}

export async function analyzeTranscript(fetchImpl, apiKey, preparedTranscript, language = "ru") {
  const requestOptions = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: buildAnalysisPrompt(preparedTranscript.text, {
                shortened: preparedTranscript.shortened,
                language,
                hasTimecodes: preparedTranscript.hasTimecodes,
              }),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8_192,
      },
    }),
  };

  const deadline = Date.now() + GEMINI_TOTAL_TIMEOUT_MS;

  for (let attempt = 1; attempt <= GEMINI_ATTEMPTS; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    let response;
    try {
      response = await fetchWithTimeout(
        fetchImpl,
        endpointFor(GEMINI_MODEL),
        requestOptions,
        Math.min(GEMINI_ATTEMPT_TIMEOUT_MS, remainingMs),
      );
    } catch (error) {
      const canRetry =
        attempt < GEMINI_ATTEMPTS && deadline - Date.now() > GEMINI_RETRY_DELAY_MS;

      if (canRetry) {
        console.warn("[gemini] retrying Flash-Lite request", {
          attempt,
          reason: error?.name === "AbortError" ? "timeout" : "network",
        });
        await new Promise((resolve) => setTimeout(resolve, GEMINI_RETRY_DELAY_MS));
        continue;
      }

      if (error?.name === "AbortError") {
        throw new PublicError(
          504,
          "GEMINI_TIMEOUT",
          "Анализ занял слишком много времени. Попробуйте ещё раз.",
        );
      }
      throw new PublicError(
        502,
        "GEMINI_UNAVAILABLE",
        "Не удалось связаться с AI-моделью. Попробуйте позже.",
      );
    }

    if (response.ok) {
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new PublicError(
          502,
          "GEMINI_BAD_RESPONSE",
          "AI-модель вернула некорректный ответ.",
        );
      }

      const analysis = extractGeminiText(payload);
      if (!analysis) {
        throw new PublicError(
          502,
          "GEMINI_EMPTY_RESPONSE",
          "AI-модель вернула пустой ответ.",
        );
      }

      return analysis;
    }

    await logGeminiFailure(response);
    if (
      response.status === 503 &&
      attempt < GEMINI_ATTEMPTS &&
      deadline - Date.now() > GEMINI_RETRY_DELAY_MS
    ) {
      await new Promise((resolve) => setTimeout(resolve, GEMINI_RETRY_DELAY_MS));
      continue;
    }

    throw new PublicError(
      response.status === 429 ? 429 : response.status === 503 ? 503 : 502,
      response.status === 429
        ? "GEMINI_RATE_LIMIT"
        : response.status === 503
          ? "GEMINI_BUSY"
          : "GEMINI_ERROR",
      response.status === 429
        ? "Все доступные AI-модели достигли бесплатного лимита. Повторите попытку позже."
        : response.status === 503
          ? "AI-модели временно перегружены. Повторите через минуту."
          : "AI-модель не смогла выполнить анализ. Попробуйте другой ролик.",
    );
  }

  throw new PublicError(
    504,
    "GEMINI_TIMEOUT",
    "Анализ занял слишком много времени. Попробуйте ещё раз.",
  );
}

function structuredRequestOptions(apiKey, preparedTranscript, language) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: buildStructuredAnalysisPrompt(preparedTranscript.text, {
                shortened: preparedTranscript.shortened,
                language,
                hasTimecodes: preparedTranscript.hasTimecodes,
              }),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.15,
        maxOutputTokens: 8_192,
        responseMimeType: "application/json",
        responseJsonSchema: STRUCTURED_ANALYSIS_SCHEMA,
      },
    }),
  };
}

export async function analyzeTranscriptStructured(
  fetchImpl,
  apiKey,
  preparedTranscript,
  language = "ru",
) {
  const attempts = [GEMINI_MODEL, GEMINI_MODEL, GEMINI_FALLBACK_MODEL];
  const deadline = Date.now() + 78_000;
  let lastFailure = "GEMINI_UNAVAILABLE";

  for (let index = 0; index < attempts.length; index += 1) {
    const model = attempts[index];
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;

    let response;
    try {
      response = await fetchWithTimeout(
        fetchImpl,
        endpointFor(model),
        structuredRequestOptions(apiKey, preparedTranscript, language),
        Math.min(26_000, remainingMs),
      );
    } catch (error) {
      lastFailure = error?.name === "AbortError" ? "GEMINI_TIMEOUT" : "GEMINI_UNAVAILABLE";
      console.warn("[gemini] structured attempt failed", {
        model,
        attempt: index + 1,
        reason: error?.name === "AbortError" ? "timeout" : "network",
      });
      continue;
    }

    if (!response.ok) {
      await logGeminiFailure(response);
      lastFailure = response.status === 429
        ? "GEMINI_RATE_LIMIT"
        : response.status === 503
          ? "GEMINI_BUSY"
          : "GEMINI_ERROR";
      if ([429, 503].includes(response.status)) continue;
      break;
    }

    try {
      const payload = await response.json();
      const text = extractGeminiText(payload);
      const raw = JSON.parse(text);
      const analysis = normalizeStructuredAnalysis(
        raw,
        preparedTranscript.allowedTimestampSeconds,
        preparedTranscript.hasTimecodes,
      );
      return {
        analysis,
        analysisText: structuredAnalysisToText(analysis, language),
        model,
      };
    } catch (error) {
      console.warn("[gemini] invalid structured response", {
        model,
        attempt: index + 1,
        reason: error?.name || "Error",
      });
      lastFailure = "GEMINI_BAD_RESPONSE";
    }
  }

  const status = lastFailure === "GEMINI_RATE_LIMIT"
    ? 429
    : lastFailure === "GEMINI_TIMEOUT"
      ? 504
      : lastFailure === "GEMINI_BUSY"
        ? 503
        : 502;
  throw new PublicError(status, lastFailure, "AI analysis could not be completed.");
}
