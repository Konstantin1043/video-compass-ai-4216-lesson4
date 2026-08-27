import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import analyzeFunction from "../api/analyze.js";
import loginFunction from "../api/auth/login.js";
import logoutFunction from "../api/auth/logout.js";
import registerFunction from "../api/auth/register.js";
import sessionFunction from "../api/auth/session.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 3000);
const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/script.js", ["script.js", "text/javascript; charset=utf-8"]],
  ["/lib/analysis-sections.js", ["lib/analysis-sections.js", "text/javascript; charset=utf-8"]],
  ["/lib/language.js", ["lib/language.js", "text/javascript; charset=utf-8"]],
  ["/lib/ui-translations.js", ["lib/ui-translations.js", "text/javascript; charset=utf-8"]],
]);
const apiFunctions = new Map([
  ["/api/analyze", analyzeFunction],
  ["/api/auth/login", loginFunction],
  ["/api/auth/logout", logoutFunction],
  ["/api/auth/register", registerFunction],
  ["/api/auth/session", sessionFunction],
]);

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function handleApi(nodeRequest, nodeResponse, apiFunction) {
  const body = await readBody(nodeRequest);
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeRequest.headers)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const requestOptions = {
    method: nodeRequest.method,
    headers,
    body: body.length ? body : undefined,
  };
  if (body.length) {
    requestOptions.duplex = "half";
  }

  const request = new Request(
    `http://localhost:${port}${nodeRequest.url}`,
    requestOptions,
  );
  const response = await apiFunction.fetch(request);

  const responseHeaders = Object.fromEntries(response.headers.entries());
  if (typeof response.headers.getSetCookie === "function") {
    const cookies = response.headers.getSetCookie();
    if (cookies.length) responseHeaders["set-cookie"] = cookies;
  }
  nodeResponse.writeHead(response.status, responseHeaders);
  nodeResponse.end(Buffer.from(await response.arrayBuffer()));
}

const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, `http://localhost:${port}`).pathname;

    const apiFunction = apiFunctions.get(pathname);
    if (apiFunction) {
      await handleApi(request, response, apiFunction);
      return;
    }

    const staticFile = staticFiles.get(pathname);
    if (!staticFile) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Страница не найдена");
      return;
    }

    const [fileName, contentType] = staticFile;
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    createReadStream(path.join(projectRoot, fileName)).pipe(response);
  } catch {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Ошибка локального сервера");
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`ВидеоКомпас AI: http://127.0.0.1:${port}\n`);
});
