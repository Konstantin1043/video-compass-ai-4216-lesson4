import { errorResponse, jsonResponse, readJsonBody } from "../../lib/http.js";
import {
  languageFromAcceptLanguage,
  normalizeLanguage,
  serverMessage,
} from "../../lib/language.js";
import {
  clearSessionCookies,
  createSupabaseService,
  sessionCookies,
  SupabaseError,
} from "../../lib/supabase.js";

export function requestLanguage(request, body) {
  return (
    normalizeLanguage(body?.language) ||
    languageFromAcceptLanguage(request.headers.get("accept-language"), "ru")
  );
}

export function validateCredentials(body) {
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
    return { error: "INVALID_EMAIL" };
  }
  if (password.length < 8 || password.length > 128) {
    return { error: "INVALID_PASSWORD" };
  }
  return { email, password };
}

export function authErrorResponse(language, error, request, extraCookies = []) {
  if (error instanceof SupabaseError) {
    return errorResponse(language, error.code, error.status, serverMessage, {
      cookies: extraCookies,
    });
  }
  return errorResponse(language, "AUTH_TEMPORARY_ERROR", 503, serverMessage, {
    cookies: extraCookies,
  });
}

export function publicUser(user, credit) {
  return {
    id: user.id,
    email: user.email,
    credits: Number(credit?.credits_remaining ?? 0),
    nextResetAt: credit?.next_reset_at || null,
  };
}

export async function credentialsBody(request) {
  const parsed = await readJsonBody(request);
  return parsed;
}

export {
  clearSessionCookies,
  createSupabaseService,
  errorResponse,
  jsonResponse,
  serverMessage,
  sessionCookies,
};
