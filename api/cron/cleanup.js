import { jsonResponse } from "../../lib/http.js";
import { createSupabaseService } from "../../lib/supabase.js";

export default {
  async fetch(request) {
    if (request.method !== "GET") return jsonResponse({ ok: false }, 405, { headers: { Allow: "GET" } });
    if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
      return jsonResponse({ ok: false }, 401);
    }
    try {
      const supabase = createSupabaseService();
      const cleaned = await supabase.serviceRpc("cleanup_video_compass");
      return jsonResponse({ ok: true, cleaned });
    } catch {
      return jsonResponse({ ok: false }, 503);
    }
  },
};

