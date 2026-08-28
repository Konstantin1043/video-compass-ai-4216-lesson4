import { createHash, randomBytes } from "node:crypto";
import { createAnalysisStore, publicResult } from "../lib/analysis-store.js";
import { errorResponse, jsonResponse, readJsonBody } from "../lib/http.js";
import { languageFromAcceptLanguage, serverMessage } from "../lib/language.js";
import { validateMutationRequest } from "../lib/security.js";
import { createSupabaseService, SupabaseError } from "../lib/supabase.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function siteOrigin(request, env) {
  try {
    const configured = new URL(env.PUBLIC_SITE_URL || request.url);
    if (configured.protocol === "https:" || configured.hostname === "localhost") {
      return configured.origin;
    }
  } catch {
    // Fall back to the verified request origin below.
  }
  return new URL(request.url).origin;
}

export function createShareHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async function share(request) {
    const language = languageFromAcceptLanguage(request.headers.get("accept-language"), "ru");
    if (!["GET", "POST", "DELETE"].includes(request.method)) {
      return errorResponse(language, "METHOD_NOT_ALLOWED", 405, serverMessage, {
        headers: { Allow: "GET, POST, DELETE" },
      });
    }

    try {
      const supabase = createSupabaseService({ env, fetchImpl });
      const store = createAnalysisStore(supabase);

      if (request.method === "GET") {
        const token = new URL(request.url).searchParams.get("token") || "";
        if (!TOKEN_PATTERN.test(token)) {
          return errorResponse(language, "SHARE_NOT_FOUND", 404, serverMessage);
        }
        const shared = await store.findShareByHash(tokenHash(token));
        if (!shared) return errorResponse(language, "SHARE_NOT_FOUND", 404, serverMessage);
        const result = publicResult(shared.result);
        delete result.transcript;
        return jsonResponse({
          ok: true,
          result,
          expiresAt: shared.share.expires_at,
        });
      }

      const securityError = validateMutationRequest(request, { allowMethods: ["POST", "DELETE"] });
      if (securityError) {
        return errorResponse(language, securityError, securityError === "UNSUPPORTED_MEDIA_TYPE" ? 415 : 403, serverMessage);
      }
      const parsed = await readJsonBody(request, 1_024);
      if (parsed.error || !UUID_PATTERN.test(parsed.body?.jobId || "")) {
        return errorResponse(language, parsed.error || "INVALID_JOB_ID", 400, serverMessage);
      }
      const active = await supabase.resolveSession(request);
      if (!active) return errorResponse(language, "AUTH_REQUIRED", 401, serverMessage);
      const data = await store.getJob(active.user.id, parsed.body.jobId);
      if (!data || data.result.status !== "completed") {
        return errorResponse(language, "JOB_NOT_FOUND", 404, serverMessage, { cookies: active.cookies });
      }

      await store.revokeShares(active.user.id, parsed.body.jobId);
      if (request.method === "DELETE") {
        return jsonResponse({ ok: true }, 200, { cookies: active.cookies });
      }

      const token = randomBytes(24).toString("base64url");
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString();
      await store.createShare({
        job_id: parsed.body.jobId,
        user_id: active.user.id,
        token_hash: tokenHash(token),
        expires_at: expiresAt,
      });
      return jsonResponse({
        ok: true,
        url: `${siteOrigin(request, env)}/share/${token}`,
        expiresAt,
      }, 201, { cookies: active.cookies });
    } catch (error) {
      const code = error instanceof SupabaseError ? error.code : "UNEXPECTED_ERROR";
      const status = error instanceof SupabaseError ? error.status : 500;
      return errorResponse(language, code, status, serverMessage);
    }
  };
}

const handler = createShareHandler();
export const maxDuration = 20;
export default { fetch: (request) => handler(request) };

