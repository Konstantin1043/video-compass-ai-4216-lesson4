import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app-v21.js", import.meta.url);
const htmlUrl = new URL("../index.html", import.meta.url);
const stylesUrl = new URL("../styles.css", import.meta.url);
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

test("после завершения анализа индикатор останавливается и становится отметкой", async () => {
  const [source, styles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  assert.match(source, /progress\.classList\.remove\("is-complete"\)/);
  assert.match(source, /progress\.classList\.add\("is-complete"\)/);
  assert.match(styles, /\.progress-panel\.is-complete \.spinner[\s\S]+animation: completion-mark/);
  assert.match(styles, /\.progress-panel\.is-complete \.spinner::after[\s\S]+content: "✓"/);
});

test("интерфейс содержит историю, три вкладки, демонстрацию и три экспорта", async () => {
  const html = await readFile(htmlUrl, "utf8");
  assert.match(html, /id="historySection"/);
  assert.equal((html.match(/data-result-tab=/g) || []).length, 3);
  assert.match(html, /id="demoButton"/);
  assert.match(html, /id="textButton"/);
  assert.match(html, /id="markdownButton"/);
  assert.match(html, /id="pdfButton"/);
  assert.doesNotMatch(html, /id="shareButton"|id="shareConfirmation"/);
});

test("разделы открываются сразу, экспорт закрывается снаружи, а языковой фильтр удалён", async () => {
  const [source, html] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(htmlUrl, "utf8"),
  ]);
  assert.match(source, /card\.open = true/);
  assert.match(source, /document\.addEventListener\("pointerdown"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /closeExportMenu/);
  assert.doesNotMatch(html, /historyLanguageFilter/);
});

test("история содержит удаление с обратной связью, а шапка прокручивается вместе со страницей", async () => {
  const [source, html, styles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(htmlUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  assert.match(source, /history-delete-button/);
  assert.match(source, /setActionBusy/);
  assert.match(source, /method: "DELETE"/);
  assert.match(html, /id="siteHeader"/);
  assert.doesNotMatch(styles, /\.site-header\.is-compact/);
  const headerStyles = styles.match(/\.site-header\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(headerStyles, /position:\s*sticky/);
  assert.doesNotMatch(source, /updateStickyHeader|headerAnimationFrame/);
  assert.match(styles, /\.history-card-actions button:active/);
});

test("главный экран использует оптимизированную AI-иллюстрацию", async () => {
  const [html, styles] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  assert.match(html, /hero-ai-flow-1200\.webp/);
  assert.match(html, /hero-ai-flow-720\.webp/);
  assert.match(styles, /\.hero\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*0\.95fr\)\s+minmax\(520px,\s*1\.05fr\)/);
  assert.match(styles, /\.hero-visual\s*\{[\s\S]*width:\s*min\(100%,\s*620px\)/);
  assert.match(styles, /\.hero h1\s*\{[\s\S]*"Segoe UI Variable Display"[\s\S]*font-size:\s*clamp\(3\.1rem,\s*3\.8vw,\s*3\.625rem\)[\s\S]*font-weight:\s*560/);
  assert.doesNotMatch(styles, /"Aptos Display"/);
  assert.match(styles, /@media\s*\(max-width:\s*680px\)[\s\S]*\.hero h1\s*\{[\s\S]*font-size:\s*clamp\(2\.2rem,\s*10vw,\s*2\.5rem\)/);
});

test("раздел процесса показывает шесть адаптивных плиток без нумерации и рекламного подзаголовка", async () => {
  const [html, styles] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  assert.equal((html.match(/class="process-card /g) || []).length, 6);
  assert.equal((html.match(/class="process-icon"/g) || []).length, 6);
  assert.doesNotMatch(html, /<ol class="process-list"|<span>[1-6]<\/span>/);
  assert.doesNotMatch(html, /От ссылки до понятного разбора/);
  assert.match(styles, /\.process-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,/);
  assert.match(styles, /\.process-card:hover\s*\{[\s\S]*translateY\(-5px\)/);
  assert.match(styles, /@media\s*\(max-width:\s*680px\)[\s\S]*\.process-grid\s*\{[\s\S]*grid-template-columns:\s*1fr/);
});

test("единый выпадающий выбор языка расположен последним в шапке", async () => {
  const [source, html, styles, privacy, privacySource] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(htmlUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
    readFile(new URL("../privacy.html", import.meta.url), "utf8"),
    readFile(new URL("../privacy.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="languageMenuButton"[\s\S]+id="languageMenu"/);
  assert.equal((html.match(/data-language-option="(?:ru|en|lv)"/g) || []).length, 3);
  assert.match(html, /data-language-option="lv"[\s\S]+Latviešu[\s\S]+data-language-option="en"[\s\S]+English[\s\S]+data-language-option="ru"[\s\S]+Русский/);
  assert.doesNotMatch(html, /class="language-switcher"|mobileLanguageSelect/);
  assert.doesNotMatch(html, /<select|⌄|▼/);
  assert.match(html, /id="logoutButton"[\s\S]+class="language-picker"/);
  assert.match(source, /elements\.languageCurrent\.textContent = language\.toUpperCase\(\)/);
  assert.match(source, /option\.setAttribute\("aria-selected"/);
  assert.match(source, /elements\.languageButton\.disabled = busy/);
  assert.match(source, /setLanguageMenuOpen/);
  assert.match(source, /document\.addEventListener\("pointerdown"[\s\S]+languageMenu\.parentElement/);
  assert.match(source, /event\.key === "Escape"[\s\S]+setLanguageMenuOpen/);
  assert.match(styles, /\.language-picker\s*\{[\s\S]+display:\s*inline-flex/);
  assert.match(styles, /\.language-icon\s*\{[\s\S]+stroke:\s*currentColor/);
  assert.match(styles, /\.language-menu\s*\{[\s\S]+width:\s*190px/);
  assert.match(styles, /\.language-menu\[hidden\]\s*\{[\s\S]+display:\s*none/);
  assert.match(styles, /\.language-menu button\[aria-selected="true"\] \.language-check/);
  assert.doesNotMatch(styles, /\.language-picker::after|content:\s*"⌄"/);
  assert.match(privacy, /id="privacyLanguageMenuButton"[\s\S]+data-privacy-language-option="lv"[\s\S]+Latviešu/);
  assert.doesNotMatch(privacy, /privacyLanguageSelect|<select/);
  assert.match(privacySource, /setLanguageMenuOpen/);
  assert.match(privacySource, /event\.key === "Escape"/);
});

test("история не оставляет избыточный промежуток перед плитками процесса", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  assert.match(styles, /\.history-section\s*\{[\s\S]*padding:\s*70px 0 38px/);
  assert.match(styles, /\.history-section:not\(\[hidden\]\) \+ \.how-it-works\s*\{[\s\S]*padding-top:\s*48px/);
});

test("шапка не использует сокращение VC и компактно показывает бренд и кредиты на мобильных", async () => {
  const [source, html, privacy, share, styles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(htmlUrl, "utf8"),
    readFile(new URL("../privacy.html", import.meta.url), "utf8"),
    readFile(new URL("../share.html", import.meta.url), "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  for (const page of [html, privacy, share]) {
    assert.doesNotMatch(page, />VC</);
    assert.match(page, /class="brand-name"/);
  }
  assert.doesNotMatch(styles, /\.brand-mark/);
  assert.match(styles, /\.brand-name\s*\{[\s\S]*display:\s*inline-flex[\s\S]*font-size:\s*1\.08rem/);
  assert.match(styles, /any-pointer:\s*coarse[\s\S]*\.brand-name\s*\{[\s\S]*flex-direction:\s*column[\s\S]*font-size:\s*0\.8rem/);
  assert.match(styles, /\.credit-badge::after\s*\{[\s\S]*attr\(data-compact-label\)/);
  assert.match(source, /dataset\.compactLabel = authenticated \? `\$\{state\.user\.credits\}\/10`/);
});

test("панель пользователя не показывает подсказку и объединяет кредиты с историей", async () => {
  const [source, html, styles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(htmlUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  assert.match(html, /id="creditBadge"[\s\S]+id="historyButton"[\s\S]+id="userEmail"[\s\S]+id="logoutButton"/);
  assert.doesNotMatch(source, /creditBadge\.title\s*=/);
  assert.match(source, /creditBadge\.removeAttribute\("title"\)/);
  const creditStyles = styles.match(/\.credit-badge\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(creditStyles, /color:\s*var\(--accent-dark\)/);
  assert.match(creditStyles, /background:\s*transparent/);
  assert.match(creditStyles, /border:\s*0/);
  assert.match(styles, /\.header-history,\s*\.header-logout\s*\{[\s\S]*background:\s*transparent[\s\S]*border:\s*0/);
});

test("превью результата показывается целиком на компьютере и переносится над текстом на узких экранах", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  const thumbnailStyles = styles.match(/\.result-overview\s*>\s*img\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(thumbnailStyles, /width:\s*100%/);
  assert.match(thumbnailStyles, /height:\s*auto/);
  assert.match(thumbnailStyles, /object-fit:\s*contain/);
  assert.doesNotMatch(thumbnailStyles, /object-fit:\s*cover/);
  assert.match(styles, /\.result-overview\s*\{[\s\S]*grid-template-columns:\s*minmax\(300px,\s*360px\)\s+minmax\(0,\s*1fr\)/);
  assert.match(styles, /@media\s*\(max-width:\s*840px\)[\s\S]*\.result-overview\s*\{[\s\S]*grid-template-columns:\s*1fr/);
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
