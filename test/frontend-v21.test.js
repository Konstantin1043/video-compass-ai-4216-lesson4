import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app-v21.js", import.meta.url);
const htmlUrl = new URL("../index.html", import.meta.url);
const vercelUrl = new URL("../vercel.json", import.meta.url);

async function listJavaScriptFiles(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
    if (entry.isDirectory()) return listJavaScriptFiles(entryUrl);
    return entry.isFile() && entry.name.endsWith(".js") ? [entryUrl] : [];
  }));
  return nested.flat();
}

test("клиент использует устойчивые этапы и восстанавливает активное задание", async () => {
  const source = await readFile(appUrl, "utf8");
  assert.match(source, /\/api\/analysis\/start/);
  assert.match(source, /\/api\/analysis\/step/);
  assert.match(source, /\/api\/analysis\/status/);
  assert.match(source, /videoCompassActiveJob/);
  assert.match(source, /resumeStoredJob/);
});

test("интерфейс содержит историю, три вкладки, демонстрацию и три экспорта", async () => {
  const html = await readFile(htmlUrl, "utf8");
  assert.match(html, /id="historySection"/);
  assert.equal((html.match(/data-result-tab=/g) || []).length, 3);
  assert.match(html, /id="demoButton"/);
  assert.match(html, /id="textButton"/);
  assert.match(html, /id="markdownButton"/);
  assert.match(html, /id="pdfButton"/);
});

test("клиентский код не исполняет AI-текст как HTML", async () => {
  const source = await readFile(appUrl, "utf8");
  assert.doesNotMatch(source, /\.innerHTML\s*=|insertAdjacentHTML|document\.write/);
  assert.match(source, /textContent =/);
});

test("публичная ссылка переписывается на безопасную страницу, а cron запускается ежедневно", async () => {
  const config = JSON.parse(await readFile(vercelUrl, "utf8"));
  assert.deepEqual(config.rewrites[0], { source: "/share/:token", destination: "/share.html?token=:token" });
  assert.deepEqual(config.crons[0], { path: "/api/cron/cleanup", schedule: "0 3 * * *" });
  const csp = config.headers[0].headers.find((header) => header.key === "Content-Security-Policy").value;
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /challenges\.cloudflare\.com/);
});

test("проект укладывается в лимит 12 функций бесплатного тарифа Vercel", async () => {
  const functions = await listJavaScriptFiles(new URL("../api/", import.meta.url));
  assert.equal(functions.length, 12);
  assert.ok(functions.some((fileUrl) => decodeURIComponent(fileUrl.pathname).endsWith("/analysis/[action].js")));
});
