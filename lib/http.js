export function jsonResponse(payload, status = 200, options = {}) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    ...options.headers,
  });

  for (const cookie of options.cookies || []) {
    headers.append("Set-Cookie", cookie);
  }

  return Response.json(payload, { status, headers });
}

export function errorResponse(language, code, status, serverMessage, options = {}) {
  return jsonResponse(
    {
      ok: false,
      error: {
        code,
        message: serverMessage(language, code, options.params || {}),
      },
    },
    status,
    options,
  );
}

export async function readJsonBody(request, maxCharacters = 4_096) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxCharacters) {
    return { error: "BODY_TOO_LARGE" };
  }

  let bodyText;
  try {
    bodyText = await request.text();
  } catch {
    return { error: "INVALID_BODY" };
  }

  if (bodyText.length > maxCharacters) {
    return { error: "BODY_TOO_LARGE" };
  }

  try {
    return { body: JSON.parse(bodyText || "{}") };
  } catch {
    return { error: "INVALID_JSON" };
  }
}
