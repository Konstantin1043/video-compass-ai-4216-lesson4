export class PublicError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "PublicError";
    this.status = status;
    this.code = code;
  }
}

export async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
