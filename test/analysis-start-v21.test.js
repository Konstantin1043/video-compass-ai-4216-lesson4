import assert from "node:assert/strict";
import test from "node:test";
import { createStartAnalysisHandler } from "../api/analysis/start.js";

const user = { id: "11111111-1111-4111-8111-111111111111", email: "student@example.com" };
const requestId = "123e4567-e89b-42d3-a456-426614174000";
const resultId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const env = {
  APIFY_API_TOKEN: "apify-test",
  GEMINI_API_KEY: "gemini-test",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable-test",
  SUPABASE_SECRET_KEY: "secret-test",
  MAX_EXTERNAL_ANALYSES_PER_DAY: "100",
  MAX_EXTERNAL_ANALYSES_PER_MONTH: "1000",
};

function input() {
  return new Request("https://videocompass.vercel.app/api/analysis/start", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://videocompass.vercel.app" },
    body: JSON.stringify({
      youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
      language: "ru",
      requestId,
    }),
  });
}

function service(overrides = {}) {
  return {
    resolveSession: async () => ({ user, accessToken: "access", cookies: [] }),
    creditStatus: async () => ({ credits_remaining: 8, next_reset_at: "2026-08-29T21:00:00Z" }),
    reserveCredit: async () => assert.fail("Кэш не должен списывать кредит"),
    refundCredit: async () => {},
    serviceRpc: async () => 0,
    serviceRequest: async (path, options = {}) => {
      if (path.includes("request_id=eq.")) return [];
      if (path.includes("analysis_results?select=id")) return [];
      if (path.includes("status=in.(queued")) return [];
      if (path.includes("analysis_results?select=*") && path.includes("cache_key=eq.")) {
        return [{
          id: resultId,
          cache_key: "dQw4w9WgXcQ:ru:gemini-3.5-flash-lite:2.1",
          video_id: "dQw4w9WgXcQ",
          canonical_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          language: "ru",
          model: "gemini-3.5-flash-lite",
          status: "completed",
          analysis: { score: 80 },
          analysis_text: "Готово",
          transcript_segments: [],
          completed_at: new Date().toISOString(),
        }];
      }
      if (path === "rest/v1/analysis_jobs" && options.method === "POST") {
        return [{ id: jobId, ...options.body, created_at: new Date().toISOString() }];
      }
      if (path.includes("last_accessed_at")) return null;
      return [];
    },
    ...overrides,
  };
}

test("24-часовой общий кэш возвращает результат без списания кредита", async () => {
  let reserved = 0;
  const handler = createStartAnalysisHandler({
    env,
    supabaseService: service({ reserveCredit: async () => { reserved += 1; } }),
  });
  const response = await handler(input());
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.job.cacheHit, true);
  assert.equal(payload.job.result.analysisText, "Готово");
  assert.equal(reserved, 0);
});

test("дневной или месячный финансовый предел останавливает анализ до внешних API", async () => {
  let countCalls = 0;
  let reserved = 0;
  const noCache = service({
    reserveCredit: async () => { reserved += 1; },
    serviceRpc: async (name) => {
      if (name === "count_external_analyses_since") {
        countCalls += 1;
        return countCalls === 1 ? 0 : 1000;
      }
      return null;
    },
    serviceRequest: async (path) => {
      if (path.includes("analysis_jobs") || path.includes("analysis_results")) return [];
      return null;
    },
  });
  const handler = createStartAnalysisHandler({ env, supabaseService: noCache });
  const response = await handler(input());
  const payload = await response.json();
  assert.equal(response.status, 429);
  assert.equal(payload.error.code, "COST_GUARD_REACHED");
  assert.equal(reserved, 0);
  assert.equal(countCalls, 2);
});

