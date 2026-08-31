import { jsonResponse } from "../lib/http.js";

export default {
  fetch(request) {
    if (request.method !== "GET") return jsonResponse({ ok: false }, 405, { headers: { Allow: "GET" } });
    const env = process.env;
    return jsonResponse({
      ok: true,
      version: "2.2.0",
      services: {
        apify: Boolean(env.APIFY_API_TOKEN),
        gemini: Boolean(env.GEMINI_API_KEY),
        supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_SECRET_KEY),
        rateLimit: Boolean(env.RATE_LIMIT_SECRET),
        captcha: Boolean(env.TURNSTILE_SITE_KEY),
      },
    });
  },
};
