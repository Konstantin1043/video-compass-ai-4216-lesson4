import { jsonResponse } from "../lib/http.js";

export default {
  fetch(request) {
    if (request.method !== "GET") {
      return jsonResponse({ ok: false, error: { code: "METHOD_NOT_ALLOWED" } }, 405, {
        headers: { Allow: "GET" },
      });
    }
    return jsonResponse({
      ok: true,
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || "",
      captchaRequired: process.env.TURNSTILE_REQUIRED === "true",
      contactEmail: process.env.PUBLIC_CONTACT_EMAIL || "",
      controllerName: process.env.PUBLIC_CONTROLLER_NAME || "VideoCompass AI",
      version: "2.1.0",
    });
  },
};

