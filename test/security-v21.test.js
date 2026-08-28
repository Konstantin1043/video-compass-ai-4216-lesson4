import assert from "node:assert/strict";
import test from "node:test";
import { requestFingerprint, validateMutationRequest } from "../lib/security.js";

function mutation(headers = {}, method = "POST") {
  return new Request("https://videocompass.vercel.app/api/analysis/start", {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: method === "GET" ? undefined : "{}",
  });
}

test("мутация принимает запрос своего origin", () => {
  assert.equal(validateMutationRequest(mutation({
    Origin: "https://videocompass.vercel.app",
    "Sec-Fetch-Site": "same-origin",
  })), null);
});

test("мутация отклоняет чужой origin и cross-site", () => {
  assert.equal(validateMutationRequest(mutation({ Origin: "https://evil.example" })), "CROSS_SITE_REQUEST");
  assert.equal(validateMutationRequest(mutation({ "Sec-Fetch-Site": "cross-site" })), "CROSS_SITE_REQUEST");
});

test("мутация требует JSON и разрешённый метод", () => {
  assert.equal(validateMutationRequest(new Request("https://videocompass.vercel.app/api/share", {
    method: "POST", headers: { "Content-Type": "text/plain" }, body: "x",
  })), "UNSUPPORTED_MEDIA_TYPE");
  assert.equal(validateMutationRequest(mutation({}, "PUT")), "METHOD_NOT_ALLOWED");
});

test("ограничение запросов хранит только необратимый HMAC-отпечаток", () => {
  const request = mutation({ "x-forwarded-for": "203.0.113.8" });
  const fingerprint = requestFingerprint(request, "rate-secret", "user-1");
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(fingerprint, /203\.0\.113\.8|user-1/);
  assert.equal(requestFingerprint(request, "", "user-1"), null);
});

