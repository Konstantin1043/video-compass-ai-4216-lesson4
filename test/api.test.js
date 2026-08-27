import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyzeHandler, createRateLimiter } from "../api/analyze.js";
import { SupabaseError } from "../lib/supabase.js";

function request(body, method = "POST", extraHeaders = {}) {
  return new Request("http://localhost/api/analyze", {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "127.0.0.1",
      ...extraHeaders,
    },
    body:
      method === "POST"
        ? JSON.stringify({
            requestId: "123e4567-e89b-42d3-a456-426614174000",
            ...body,
          })
        : undefined,
  });
}

function authenticatedSupabase(overrides = {}) {
  return {
    resolveSession: async () => ({
      user: { id: "user-1", email: "student@example.com" },
      accessToken: "access-token",
      cookies: [],
    }),
    reserveCredit: async () => ({ credits_remaining: 9 }),
    commitCredit: async () => ({
      credits_remaining: 9,
      next_reset_at: "2026-08-28T21:00:00.000Z",
    }),
    refundCredit: async () => ({ credits_remaining: 10 }),
    ...overrides,
  };
}

function handlerWith(options = {}) {
  return createAnalyzeHandler({
    env: options.env || {},
    fetchImpl: options.fetchImpl || (async () => assert.fail("Внешний API не должен вызываться")),
    rateLimiter: createRateLimiter({ limit: 100 }),
    supabaseService: options.supabaseService || authenticatedSupabase(),
  });
}

test("отклоняет неподдерживаемый HTTP-метод", async () => {
  const response = await handlerWith()(request({}, "GET"));
  assert.equal(response.status, 405);
});

test("проверяет YouTube-ссылку до обращения к API", async () => {
  const response = await handlerWith()(request({ youtubeUrl: "https://example.com/video" }));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "INVALID_YOUTUBE_URL");
});

test("понятно сообщает об отсутствующих серверных переменных", async () => {
  const response = await handlerWith()(
    request({ youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" }),
  );
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.error.code, "SERVICE_NOT_CONFIGURED");
});

test("полный поток Apify → Gemini возвращает результат интерфейсу", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });

    if (String(url).includes("api.apify.com")) {
      return Response.json([
        { transcript_only_text: "Это тестовый транскрипт полезного видео." },
      ]);
    }

    return Response.json({
      candidates: [
        {
          content: {
            parts: [{ text: "1. О ЧЁМ ВИДЕО\nТестовый анализ." }],
          },
        },
      ],
    });
  };
  const handler = handlerWith({
    env: { APIFY_API_TOKEN: "apify-secret", GEMINI_API_KEY: "gemini-secret" },
    fetchImpl,
  });

  const response = await handler(
    request({ youtubeUrl: "https://youtube.com/shorts/dQw4w9WgXcQ" }),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.video.videoId, "dQw4w9WgXcQ");
  assert.equal(payload.language, "ru");
  assert.match(payload.analysis, /Тестовый анализ/);
  assert.equal(payload.transcript.shortened, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, "Bearer apify-secret");
  assert.equal(calls[1].options.headers["x-goog-api-key"], "gemini-secret");
  assert.match(calls[1].url, /models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.doesNotMatch(calls[1].url, /gemini-3\.7-flash/);
  const geminiBody = JSON.parse(calls[1].options.body);
  assert.match(geminiBody.contents[0].parts[0].text, /тестовый транскрипт/i);
  assert.doesNotMatch(calls[0].url, /apify-secret/);
});

test("передаёт английский язык в промпт Gemini и ответ API", async () => {
  let geminiPrompt = "";
  const handler = handlerWith({
    env: { APIFY_API_TOKEN: "token", GEMINI_API_KEY: "key" },
    fetchImpl: async (url, options) => {
      if (String(url).includes("api.apify.com")) {
        return Response.json([{ transcript_only_text: "Тестовый транскрипт." }]);
      }

      geminiPrompt = JSON.parse(options.body).contents[0].parts[0].text;
      return Response.json({
        candidates: [{ content: { parts: [{ text: "1. WHAT THE VIDEO IS ABOUT\nTest." }] } }],
      });
    },
  });

  const response = await handler(
    request(
      { youtubeUrl: "https://youtu.be/dQw4w9WgXcQ", language: "en" },
      "POST",
      { "Accept-Language": "en" },
    ),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.language, "en");
  assert.match(geminiPrompt, /answer entirely in English/i);
  assert.match(geminiPrompt, /WHAT THE VIDEO IS ABOUT/);
});

test("без поля language сохраняет русский язык для старых клиентов", async () => {
  let geminiPrompt = "";
  const handler = handlerWith({
    env: { APIFY_API_TOKEN: "token", GEMINI_API_KEY: "key" },
    fetchImpl: async (url, options) => {
      if (String(url).includes("api.apify.com")) {
        return Response.json([{ transcript_only_text: "Тестовый транскрипт." }]);
      }

      geminiPrompt = JSON.parse(options.body).contents[0].parts[0].text;
      return Response.json({
        candidates: [{ content: { parts: [{ text: "1. О ЧЁМ ВИДЕО\nТест." }] } }],
      });
    },
  });

  const response = await handler(
    request(
      { youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" },
      "POST",
      { "Accept-Language": "en" },
    ),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.language, "ru");
  assert.match(geminiPrompt, /О ЧЁМ ВИДЕО/);
});

test("отклоняет неизвестный язык до обращения к внешним API", async () => {
  const response = await handlerWith()(
    request(
      { youtubeUrl: "https://youtu.be/dQw4w9WgXcQ", language: "de" },
      "POST",
      { "Accept-Language": "en" },
    ),
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "UNSUPPORTED_LANGUAGE");
  assert.match(payload.error.message, /Russian, English, or Latvian/i);
});

test("один раз повторяет Gemini-запрос при временной перегрузке", async () => {
  let geminiCalls = 0;
  const handler = handlerWith({
    env: { APIFY_API_TOKEN: "token", GEMINI_API_KEY: "key" },
    fetchImpl: async (url) => {
      if (String(url).includes("api.apify.com")) {
        return Response.json([{ transcript_only_text: "Тестовый транскрипт." }]);
      }

      geminiCalls += 1;
      if (geminiCalls === 1) {
        return Response.json(
          { error: { code: 503, status: "UNAVAILABLE", message: "High demand" } },
          { status: 503 },
        );
      }

      return Response.json({
        candidates: [{ content: { parts: [{ text: "Анализ после повтора." }] } }],
      });
    },
  });

  const response = await handler(
    request({ youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" }),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(geminiCalls, 2);
  assert.match(payload.analysis, /после повтора/i);
});

test("использует только Gemini Flash-Lite", async () => {
  const geminiUrls = [];
  const handler = handlerWith({
    env: { APIFY_API_TOKEN: "token", GEMINI_API_KEY: "key" },
    fetchImpl: async (url) => {
      if (String(url).includes("api.apify.com")) {
        return Response.json([{ transcript_only_text: "Тестовый транскрипт." }]);
      }

      geminiUrls.push(String(url));
      return Response.json({
        candidates: [{ content: { parts: [{ text: "Анализ моделью Flash-Lite." }] } }],
      });
    },
  });

  const response = await handler(
    request({ youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" }),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.match(payload.analysis, /Flash-Lite/i);
  assert.equal(geminiUrls.length, 1);
  assert.match(geminiUrls[0], /models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.doesNotMatch(geminiUrls[0], /gemini-3\.7-flash/);
});

test("повторяет Flash-Lite после тайм-аута первой попытки", async () => {
  let geminiCalls = 0;
  const handler = handlerWith({
    env: { APIFY_API_TOKEN: "token", GEMINI_API_KEY: "key" },
    fetchImpl: async (url) => {
      if (String(url).includes("api.apify.com")) {
        return Response.json([{ transcript_only_text: "Тестовый транскрипт." }]);
      }

      geminiCalls += 1;
      assert.match(String(url), /models\/gemini-3\.5-flash-lite:generateContent$/);
      if (geminiCalls === 1) {
        const timeoutError = new Error("Timed out");
        timeoutError.name = "AbortError";
        throw timeoutError;
      }

      return Response.json({
        candidates: [{ content: { parts: [{ text: "Анализ после тайм-аута." }] } }],
      });
    },
  });

  const response = await handler(
    request({ youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" }),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(geminiCalls, 2);
  assert.match(payload.analysis, /после тайм-аута/i);
});

test("возвращает понятную ошибку, если субтитры отсутствуют", async () => {
  const handler = handlerWith({
    env: { APIFY_API_TOKEN: "token", GEMINI_API_KEY: "key" },
    fetchImpl: async () => Response.json([]),
  });
  const response = await handler(
    request({ youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
  );
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.error.code, "TRANSCRIPT_NOT_FOUND");
});

test("локализует ошибку отсутствующих субтитров на латышский", async () => {
  const handler = handlerWith({
    env: { APIFY_API_TOKEN: "token", GEMINI_API_KEY: "key" },
    fetchImpl: async () => Response.json([]),
  });
  const response = await handler(
    request(
      { youtubeUrl: "https://youtu.be/dQw4w9WgXcQ", language: "lv" },
      "POST",
      { "Accept-Language": "lv" },
    ),
  );
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.error.code, "TRANSCRIPT_NOT_FOUND");
  assert.match(payload.error.message, /Subtitri nav pieejami/i);
});

test("ограничивает частоту повторных запросов", async () => {
  let currentTime = 1_000;
  const limiter = createRateLimiter({
    limit: 1,
    windowMs: 10_000,
    now: () => currentTime,
  });
  const handler = createAnalyzeHandler({ env: {}, rateLimiter: limiter });

  const first = await handler(request({ youtubeUrl: "не ссылка" }));
  assert.equal(first.status, 400);

  const second = await handler(request({ youtubeUrl: "не ссылка" }));
  assert.equal(second.status, 429);

  currentTime += 10_001;
  const third = await handler(request({ youtubeUrl: "не ссылка" }));
  assert.equal(third.status, 400);
});

test("не запускает внешние API без авторизованного пользователя", async () => {
  const handler = handlerWith({
    env: { APIFY_API_TOKEN: "token", GEMINI_API_KEY: "key" },
    supabaseService: authenticatedSupabase({ resolveSession: async () => null }),
  });

  const response = await handler(
    request({ youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" }),
  );
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.error.code, "AUTH_REQUIRED");
});

test("не запускает Apify, когда ежедневные кредиты закончились", async () => {
  const handler = handlerWith({
    env: { APIFY_API_TOKEN: "token", GEMINI_API_KEY: "key" },
    supabaseService: authenticatedSupabase({
      reserveCredit: async () => {
        throw new SupabaseError("NO_CREDITS", 403);
      },
    }),
  });

  const response = await handler(
    request({ youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" }),
  );
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error.code, "NO_CREDITS");
});

test("возвращает кредит, если транскрипт получить не удалось", async () => {
  let refunds = 0;
  const handler = handlerWith({
    env: { APIFY_API_TOKEN: "token", GEMINI_API_KEY: "key" },
    fetchImpl: async () => Response.json([]),
    supabaseService: authenticatedSupabase({
      refundCredit: async () => {
        refunds += 1;
        return { credits_remaining: 10 };
      },
    }),
  });

  const response = await handler(
    request({ youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" }),
  );

  assert.equal(response.status, 422);
  assert.equal(refunds, 1);
});

test("успешный анализ списывает ровно один кредит", async () => {
  const operations = [];
  const handler = handlerWith({
    env: { APIFY_API_TOKEN: "token", GEMINI_API_KEY: "key" },
    fetchImpl: async (url) => {
      operations.push(String(url).includes("api.apify.com") ? "apify" : "gemini");
      if (String(url).includes("api.apify.com")) {
        return Response.json([{ transcript_only_text: "Тестовый транскрипт." }]);
      }
      return Response.json({
        candidates: [{ content: { parts: [{ text: "Готовый анализ." }] } }],
      });
    },
    supabaseService: authenticatedSupabase({
      reserveCredit: async () => {
        operations.push("reserve");
        return { credits_remaining: 9 };
      },
      commitCredit: async () => {
        operations.push("commit");
        return { credits_remaining: 9, next_reset_at: "2026-08-28T21:00:00Z" };
      },
    }),
  });

  const response = await handler(
    request({ youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" }),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.creditsRemaining, 9);
  assert.deepEqual(operations, ["reserve", "apify", "gemini", "commit"]);
});

test("отклоняет запрос без UUID до авторизации", async () => {
  const response = await handlerWith()(
    request({
      youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
      requestId: "не-uuid",
    }),
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "INVALID_REQUEST_ID");
});
