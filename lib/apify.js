import { PublicError, fetchWithTimeout } from "./service-error.js";
import { transcriptDataFromApifyItem } from "./transcript.js";

const APIFY_ENDPOINT =
  "https://api.apify.com/v2/acts/scrape-creators~best-youtube-transcripts-scraper/run-sync-get-dataset-items?clean=true&format=json";

export async function fetchTranscript(fetchImpl, token, canonicalUrl) {
  let response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      APIFY_ENDPOINT,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoUrls: [canonicalUrl] }),
      },
      60_000,
    );
  } catch (error) {
    console.error("[apify] request failed", {
      name: error?.name || "Error",
      message: error?.message || "Unknown error",
      causeCode: error?.cause?.code || null,
    });

    if (error?.name === "AbortError") {
      throw new PublicError(
        504,
        "APIFY_TIMEOUT",
        "YouTube слишком долго отвечал. Попробуйте ещё раз через минуту.",
      );
    }
    throw new PublicError(
      502,
      "APIFY_UNAVAILABLE",
      "Не удалось связаться с сервисом транскриптов. Попробуйте позже.",
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new PublicError(
      503,
      "APIFY_CONFIGURATION",
      "Сервис транскриптов временно не настроен. Сообщите владельцу сайта.",
    );
  }

  if (!response.ok) {
    throw new PublicError(
      response.status === 429 ? 429 : 502,
      response.status === 429 ? "APIFY_RATE_LIMIT" : "APIFY_ERROR",
      response.status === 429
        ? "Лимит получения транскриптов временно исчерпан. Попробуйте позже."
        : "Не удалось получить транскрипт этого видео.",
    );
  }

  let items;
  try {
    items = await response.json();
  } catch {
    throw new PublicError(502, "APIFY_BAD_RESPONSE", "Сервис вернул некорректный ответ.");
  }

  const transcript = transcriptDataFromApifyItem(Array.isArray(items) ? items[0] : items);
  if (!transcript.text) {
    throw new PublicError(
      422,
      "TRANSCRIPT_NOT_FOUND",
      "У ролика нет доступных субтитров или видео закрыто. Выберите публичный ролик с субтитрами.",
    );
  }

  return transcript;
}
