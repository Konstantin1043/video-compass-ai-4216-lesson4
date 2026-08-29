import assert from "node:assert/strict";
import test from "node:test";
import { createLoginHandler } from "../api/auth/login.js";
import { createRegisterHandler } from "../api/auth/register.js";
import { createSessionHandler } from "../api/auth/session.js";
import { createSupabaseService } from "../lib/supabase.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
};

function authRequest(path, body, extraHeaders = {}) {
  return new Request(`https://video.example/api/auth/${path}`, {
    method: path === "session" ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": "ru",
      ...extraHeaders,
    },
    body: path === "session" ? undefined : JSON.stringify(body),
  });
}

test("регистрация создаёт защищённую сессию и возвращает 10 кредитов", async () => {
  const calls = [];
  const handler = createRegisterHandler({
    env,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith("/auth/v1/signup")) {
        return Response.json({
          access_token: "access-test",
          refresh_token: "refresh-test",
          expires_in: 3600,
          user: { id: "user-1", email: "student@example.com" },
        });
      }
      return Response.json([
        { credits_remaining: 10, next_reset_at: "2026-08-28T21:00:00Z" },
      ]);
    },
  });

  const response = await handler(
    authRequest("register", {
      email: "Student@example.com",
      password: "safe-pass-123",
      language: "ru",
    }),
  );
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.authenticated, true);
  assert.equal(payload.user.email, "student@example.com");
  assert.equal(payload.user.credits, 10);
  assert.equal(payload.access_token, undefined);
  assert.match(response.headers.get("set-cookie"), /vc_access=.*HttpOnly/i);
  assert.match(response.headers.get("set-cookie"), /vc_refresh=/i);
  assert.equal(calls[0].options.headers.apikey, "publishable-test-key");
  assert.doesNotMatch(calls[0].url, /publishable-test-key/);
});

test("неверный пароль возвращает локализованную ошибку без cookie", async () => {
  const handler = createLoginHandler({
    env,
    fetchImpl: async () =>
      Response.json({ message: "Invalid login credentials" }, { status: 400 }),
  });
  const response = await handler(
    authRequest("login", {
      email: "student@example.com",
      password: "wrong-pass",
      language: "ru",
    }),
  );
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.error.code, "INVALID_CREDENTIALS");
  assert.equal(response.headers.get("set-cookie"), null);
});

test("проверка сессии возвращает пользователя и текущий баланс", async () => {
  const handler = createSessionHandler({
    env,
    fetchImpl: async (url) => {
      if (String(url).endsWith("/auth/v1/user")) {
        return Response.json({ id: "user-1", email: "student@example.com" });
      }
      return Response.json([
        { credits_remaining: 7, next_reset_at: "2026-08-28T21:00:00Z" },
      ]);
    },
  });
  const response = await handler(
    authRequest("session", undefined, { Cookie: "vc_access=access-test; vc_refresh=refresh-test" }),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.authenticated, true);
  assert.equal(payload.user.credits, 7);
});

test("невалидные регистрационные данные не отправляются в Supabase", async () => {
  const handler = createRegisterHandler({
    env,
    fetchImpl: async () => assert.fail("Supabase не должен вызываться"),
  });
  const response = await handler(
    authRequest("register", {
      email: "не email",
      password: "123",
      language: "lv",
    }),
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "INVALID_EMAIL");
  assert.match(payload.error.message, /e-pasta/i);
});

test("Supabase-ключи очищаются от случайных переносов строки", async () => {
  let requestHeaders;
  const service = createSupabaseService({
    env: {
      SUPABASE_URL: "\r\n https://example.supabase.co \r\n",
      SUPABASE_PUBLISHABLE_KEY: "\r\n publishable-test-key \r\n",
      SUPABASE_SECRET_KEY: "\r\n sb_secret_test \r\n",
    },
    fetchImpl: async (_url, options) => {
      requestHeaders = options.headers;
      return Response.json([{ allowed: true }]);
    },
  });

  await service.serviceRpc("consume_rate_limit", {});

  assert.equal(requestHeaders.apikey, "sb_secret_test");
  assert.equal(requestHeaders.Authorization, undefined);
});

test("секретный Supabase-ключ не отправляется как Bearer JWT", async () => {
  let requestHeaders;
  const service = createSupabaseService({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      SUPABASE_SECRET_KEY: "sb_secret_test",
    },
    fetchImpl: async (_url, options) => {
      requestHeaders = options.headers;
      return Response.json({ id: "job-test" });
    },
  });

  await service.serviceRequest("rest/v1/analysis_jobs?id=eq.job-test");

  assert.equal(requestHeaders.apikey, "sb_secret_test");
  assert.equal("Authorization" in requestHeaders, false);
});
