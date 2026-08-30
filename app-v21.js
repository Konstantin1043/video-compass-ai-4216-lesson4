import { ANALYSIS_HEADINGS, parseAnalysisSections } from "./lib/analysis-sections.js";
import { structuredAnalysisToMarkdown } from "./lib/structured-analysis.js";
import { formatTimecode, parseTimecode, youtubeTimestampUrl } from "./lib/timecodes.js";
import { detectPreferredLanguage, UI_TRANSLATIONS, uiText } from "./lib/ui-translations.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const elements = {
  form: $("#analyzerForm"), url: $("#youtubeUrl"), submit: $("#submitButton"),
  submitLabel: $("#submitButton span"), languageButton: $("#languageMenuButton"),
  languageCurrent: $("#languageCurrent"), languageMenu: $("#languageMenu"),
  languageOptions: $$('[data-language-option]'),
  error: $("#errorMessage"), errorText: $("#errorText"), progress: $("#progressPanel"),
  progressTitle: $("#progressTitle"), progressSteps: [$("#progressStep1"), $("#progressStep2"), $("#progressStep3")],
  result: $("#result"), thumbnail: $("#videoThumbnail"), videoTitle: $("#videoTitle"),
  videoAuthor: $("#videoAuthor"), videoLink: $("#videoLink"), transcriptMeta: $("#transcriptMeta"),
  overviewScore: $("#overviewScore"), overviewAbout: $("#overviewAbout"),
  analysisText: $("#analysisText"), analysisToolbar: $("#analysisToolbar"),
  collapseAll: $("#collapseAllButton"), expandAll: $("#expandAllButton"),
  favorite: $("#favoriteButton"), copy: $("#copyButton"), textDownload: $("#textButton"), markdown: $("#markdownButton"),
  pdf: $("#pdfButton"), exportMenu: $("#exportMenu"),
  deleteAnalysis: $("#deleteAnalysisButton"), newAnalysis: $("#newAnalysisButton"),
  resultTabs: $$('[data-result-tab]'), analysisPanel: $("#analysisPanel"),
  transcriptPanel: $("#transcriptPanel"), chaptersPanel: $("#chaptersPanel"),
  transcriptSearch: $("#transcriptSearch"), transcriptCount: $("#transcriptMatchCount"),
  previousMatch: $("#previousMatchButton"), nextMatch: $("#nextMatchButton"),
  transcriptView: $("#transcriptView"), loadMoreTranscript: $("#loadMoreTranscriptButton"),
  chapters: $("#chaptersList"),
  authGate: $("#authGate"), authGateTitle: $("#authGateTitle"), authGateText: $("#authGateText"),
  openAuth: $("#openAuthButton"), gateAuth: $("#gateAuthButton"), userPanel: $("#userPanel"),
  userEmail: $("#userEmail"), creditBadge: $("#creditBadge"), logout: $("#logoutButton"),
  authDialog: $("#authDialog"), closeAuth: $("#closeAuthButton"), authForm: $("#authForm"),
  authEmail: $("#authEmail"), authPassword: $("#authPassword"), authError: $("#authError"),
  authSubmit: $("#authSubmitButton"), authSubmitLabel: $("#authSubmitButton span"),
  authModes: $$('[data-auth-mode]'), togglePassword: $("#togglePasswordButton"),
  turnstile: $("#turnstileWidget"), historyButton: $("#historyButton"),
  historySection: $("#historySection"), historySearch: $("#historySearch"),
  favoritesOnly: $("#favoritesOnly"), historyStatus: $("#historyStatus"),
  historyList: $("#historyList"), historyEmpty: $("#historyEmpty"), demo: $("#demoButton"),
  deleteAccount: $("#deleteAccountButton"), deleteAccountDialog: $("#deleteAccountDialog"),
  deleteAccountForm: $("#deleteAccountForm"), deleteAccountPassword: $("#deleteAccountPassword"),
  deleteAccountError: $("#deleteAccountError"), cancelDeleteAccount: $("#cancelDeleteAccount"),
  deleteTurnstile: $("#deleteTurnstileWidget"),
};

const state = {
  language: detectPreferredLanguage({
    storedLanguage: safeStorageGet("videoCompassLanguage"),
    browserLanguages: navigator.languages || [navigator.language],
  }),
  user: null,
  sessionLoading: true,
  analyzing: false,
  authMode: "login",
  authSubmitting: false,
  pendingAnalyze: false,
  currentJob: null,
  currentResult: null,
  history: [],
  resultCache: new Map(),
  transcriptLimit: 300,
  currentMatch: -1,
  config: { turnstileSiteKey: "", captchaRequired: false },
  captchaToken: "",
  turnstileWidgetId: null,
  deleteCaptchaToken: "",
  deleteTurnstileWidgetId: null,
  demo: false,
  historyStatusTimer: null,
};

function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* State still works in memory. */ }
}

function safeStorageRemove(key) {
  try { localStorage.removeItem(key); } catch { /* Ignore unavailable storage. */ }
}

function text(key, params = {}) {
  return uiText(state.language, key, params) || key;
}

function setLanguageMenuOpen(open, { focusSelected = false, returnFocus = false } = {}) {
  elements.languageMenu.hidden = !open;
  elements.languageButton.setAttribute("aria-expanded", String(open));
  if (open && focusSelected) {
    const selected = elements.languageOptions.find((option) => option.getAttribute("aria-selected") === "true");
    (selected || elements.languageOptions[0])?.focus();
  }
  if (!open && returnFocus) elements.languageButton.focus();
}

function moveLanguageOptionFocus(key) {
  const options = elements.languageOptions;
  const currentIndex = Math.max(0, options.indexOf(document.activeElement));
  const targetIndex = key === "Home"
    ? 0
    : key === "End"
      ? options.length - 1
      : (currentIndex + (key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
  options[targetIndex]?.focus();
}

function translatePage(language) {
  state.language = language;
  safeStorageSet("videoCompassLanguage", language);
  const dictionary = UI_TRANSLATIONS[language];
  document.documentElement.lang = language;
  document.title = dictionary.metaTitle;
  $('meta[name="description"]').content = dictionary.metaDescription;
  $('meta[property="og:description"]').content = dictionary.ogDescription;
  $$('[data-i18n]').forEach((node) => {
    const value = dictionary[node.dataset.i18n];
    if (typeof value === "string") node.textContent = value;
  });
  $$('[data-i18n-aria-label]').forEach((node) => {
    const value = dictionary[node.dataset.i18nAriaLabel];
    if (typeof value === "string") node.setAttribute("aria-label", value);
  });
  $$('[data-i18n-placeholder]').forEach((node) => {
    const value = dictionary[node.dataset.i18nPlaceholder];
    if (typeof value === "string") node.placeholder = value;
  });
  elements.languageCurrent.textContent = language.toUpperCase();
  elements.languageOptions.forEach((option) => {
    option.setAttribute("aria-selected", String(option.dataset.languageOption === language));
  });
  renderAuthMode();
  renderAuthState();
  renderHistory();
  if (state.currentResult) renderResult(state.currentJob, state.currentResult);
}

function showError(message) {
  elements.errorText.textContent = message;
  elements.error.hidden = false;
  elements.url.setAttribute("aria-invalid", "true");
}

function clearError() {
  elements.errorText.textContent = "";
  elements.error.hidden = true;
  elements.url.removeAttribute("aria-invalid");
}

function showHistoryStatus(message, isError = false) {
  clearTimeout(state.historyStatusTimer);
  elements.historyStatus.textContent = message;
  elements.historyStatus.classList.toggle("is-error", isError);
  elements.historyStatus.setAttribute("role", isError ? "alert" : "status");
  elements.historyStatus.hidden = false;
  state.historyStatusTimer = setTimeout(() => {
    elements.historyStatus.hidden = true;
  }, 3_500);
}

function setActionBusy(button, busy, busyLabel, readyLabel) {
  button.disabled = busy;
  button.classList.toggle("is-loading", busy);
  button.setAttribute("aria-busy", String(busy));
  button.textContent = busy ? busyLabel : readyLabel;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readApi(response) {
  let payload;
  try { payload = await response.json(); } catch { throw new Error(text("invalidResponse")); }
  if (!response.ok || !payload.ok) {
    const error = new Error(payload?.error?.message || text("unexpected"));
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

function updateUserCredits(payload) {
  if (!state.user || payload?.creditsRemaining === undefined) return;
  state.user = { ...state.user, credits: payload.creditsRemaining, nextResetAt: payload.nextResetAt };
  renderAuthState();
}

function parseVideoId(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!['youtu.be', 'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) return null;
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
    else if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
    else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "live", "embed"].includes(parts[0])) id = parts[1] || "";
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

function createRequestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function renderSubmitState() {
  elements.submit.disabled = state.analyzing || state.sessionLoading;
  elements.submitLabel.textContent = state.analyzing ? text("analyzing") : text("analyzeButton");
}

function renderAuthState() {
  const authenticated = Boolean(state.user);
  const noCredits = authenticated && state.user.credits <= 0;
  elements.openAuth.hidden = authenticated;
  elements.userPanel.hidden = !authenticated;
  elements.userEmail.textContent = state.user?.email || "";
  elements.creditBadge.textContent = authenticated ? text("creditsCount", { count: state.user.credits }) : "";
  elements.creditBadge.removeAttribute("title");
  elements.creditBadge.dataset.compactLabel = authenticated ? `${state.user.credits}/10` : "";
  elements.creditBadge.setAttribute("aria-label", authenticated ? text("creditsTitle", { count: state.user.credits }) : "");
  elements.authGate.hidden = authenticated && !noCredits;
  elements.gateAuth.hidden = authenticated;
  elements.authGateTitle.textContent = text(noCredits ? "noCreditsTitle" : "authGateTitle");
  elements.authGateText.textContent = text(noCredits ? "noCreditsText" : "authGateText");
  elements.historySection.hidden = !authenticated;
  elements.url.disabled = state.sessionLoading;
  renderSubmitState();
}

function renderAuthMode() {
  elements.authModes.forEach((button) => {
    const selected = button.dataset.authMode === state.authMode;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  elements.authPassword.autocomplete = state.authMode === "register" ? "new-password" : "current-password";
  elements.authSubmitLabel.textContent = state.authSubmitting
    ? text(state.authMode === "register" ? "registerSubmitting" : "loginSubmitting")
    : text(state.authMode === "register" ? "register" : "signIn");
  elements.authSubmit.disabled = state.authSubmitting;
}

function resetCaptcha() {
  state.captchaToken = "";
  if (window.turnstile && state.turnstileWidgetId !== null) window.turnstile.reset(state.turnstileWidgetId);
}

function renderTurnstile() {
  if (!state.config.turnstileSiteKey || !window.turnstile || state.turnstileWidgetId !== null) return;
  elements.turnstile.hidden = false;
  state.turnstileWidgetId = window.turnstile.render(elements.turnstile, {
    sitekey: state.config.turnstileSiteKey,
    callback: (token) => { state.captchaToken = token; },
    "expired-callback": () => { state.captchaToken = ""; },
    theme: "light",
  });
}

function renderDeleteTurnstile() {
  if (!state.config.turnstileSiteKey || !window.turnstile || state.deleteTurnstileWidgetId !== null) return;
  elements.deleteTurnstile.hidden = false;
  state.deleteTurnstileWidgetId = window.turnstile.render(elements.deleteTurnstile, {
    sitekey: state.config.turnstileSiteKey,
    callback: (token) => { state.deleteCaptchaToken = token; },
    "expired-callback": () => { state.deleteCaptchaToken = ""; },
    theme: "light",
  });
}

function resetDeleteCaptcha() {
  state.deleteCaptchaToken = "";
  if (window.turnstile && state.deleteTurnstileWidgetId !== null) {
    window.turnstile.reset(state.deleteTurnstileWidgetId);
  }
}

async function loadConfig() {
  try {
    state.config = await readApi(await fetch("/api/config", { credentials: "same-origin" }));
    if (!state.config.turnstileSiteKey) return;
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => {
      renderTurnstile();
      if (elements.deleteAccountDialog.open) renderDeleteTurnstile();
    });
    document.head.append(script);
  } catch { /* Auth remains available when public config is temporarily unavailable. */ }
}

function openAuth(mode = "login") {
  state.authMode = mode;
  elements.authError.hidden = true;
  renderAuthMode();
  elements.authDialog.showModal();
  renderTurnstile();
  setTimeout(() => elements.authEmail.focus(), 0);
}

async function loadSession() {
  try {
    const payload = await readApi(await fetch("/api/auth/session", {
      headers: { "Accept-Language": state.language }, credentials: "same-origin",
    }));
    state.user = payload.authenticated ? payload.user : null;
  } catch { state.user = null; }
  state.sessionLoading = false;
  renderAuthState();
  if (state.user) {
    await loadHistory();
    await resumeStoredJob();
  }
}

async function submitAuth() {
  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  if (!/^\S+@\S+\.\S+$/.test(email)) return showAuthError(text("invalidEmail"));
  if (password.length < 8 || password.length > 128) return showAuthError(text("invalidPassword"));
  if (state.config.captchaRequired && !state.captchaToken) return showAuthError(text("captchaRequired"));
  state.authSubmitting = true;
  elements.authError.hidden = true;
  renderAuthMode();
  try {
    const payload = await readApi(await fetch(`/api/auth/${state.authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": state.language },
      credentials: "same-origin",
      body: JSON.stringify({ email, password, language: state.language, captchaToken: state.captchaToken }),
    }));
    state.user = payload.user;
    elements.authPassword.value = "";
    elements.authDialog.close();
    renderAuthState();
    await loadHistory();
    if (state.pendingAnalyze) {
      state.pendingAnalyze = false;
      await startAnalysis(elements.url.value.trim());
    }
  } catch (error) {
    showAuthError(error.message);
    resetCaptcha();
  } finally {
    state.authSubmitting = false;
    renderAuthMode();
  }
}

function showAuthError(message) {
  elements.authError.textContent = message;
  elements.authError.hidden = false;
}

async function logout() {
  await fetch("/api/auth/logout", {
    method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": state.language },
    credentials: "same-origin", body: "{}",
  }).catch(() => {});
  state.user = null;
  state.history = [];
  state.resultCache.clear();
  clearCurrentResult();
  safeStorageRemove("videoCompassActiveJob");
  renderAuthState();
}

function progressIndex(status) {
  if (status === "queued") return 0;
  if (["transcript_processing", "transcript_ready"].includes(status)) return 1;
  return 2;
}

function renderProgress(status) {
  const index = progressIndex(status);
  const titles = [text("progressOne"), text("progressTwo"), text("progressThree")];
  elements.progress.hidden = false;
  elements.progress.classList.remove("is-complete");
  elements.progressTitle.textContent = titles[index];
  elements.progressSteps.forEach((step, position) => {
    step.classList.toggle("is-done", position < index);
    step.classList.toggle("is-active", position === index);
  });
}

function setBusy(busy) {
  state.analyzing = busy;
  elements.form.setAttribute("aria-busy", String(busy));
  elements.languageButton.disabled = busy;
  if (busy) setLanguageMenuOpen(false);
  renderSubmitState();
}

async function startAnalysis(url) {
  if (!state.user) { state.pendingAnalyze = true; openAuth("login"); return; }
  if (state.user.credits <= 0) { showError(text("noCreditsText")); return; }
  setBusy(true);
  clearError();
  elements.result.hidden = true;
  renderProgress("queued");
  try {
    const payload = await readApi(await fetch("/api/analysis/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": state.language },
      credentials: "same-origin",
      body: JSON.stringify({ youtubeUrl: url, language: state.language, requestId: createRequestId() }),
    }));
    updateUserCredits(payload);
    safeStorageSet("videoCompassActiveJob", payload.job.id);
    await runJob(payload.job);
  } catch (error) {
    showError(error.message || text("analysisFailed"));
    elements.progress.hidden = true;
    setBusy(false);
  }
}

async function statusJob(jobId) {
  return readApi(await fetch(`/api/analysis/status?jobId=${encodeURIComponent(jobId)}`, {
    headers: { "Accept-Language": state.language }, credentials: "same-origin",
  }));
}

async function runJob(initialJob) {
  let job = initialJob;
  setBusy(true);
  try {
    for (let cycle = 0; cycle < 18; cycle += 1) {
      renderProgress(job.status);
      if (job.status === "completed" && job.result) {
        finishJob(job);
        return;
      }
      if (["failed", "expired", "cancelled"].includes(job.status)) {
        throw new Error(job.errorMessage || text("analysisFailed"));
      }

      if (["queued", "transcript_ready"].includes(job.status)) {
        const stepped = await readApi(await fetch("/api/analysis/step", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept-Language": state.language },
          credentials: "same-origin",
          body: JSON.stringify({ jobId: job.id }),
        }));
        updateUserCredits(stepped);
        job = stepped.job;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        const checked = await statusJob(job.id);
        updateUserCredits(checked);
        job = checked.job;
      }
    }
    throw new Error(text("timeout"));
  } catch (error) {
    const latest = await statusJob(job.id).catch(() => null);
    if (latest?.job?.errorMessage) error.message = latest.job.errorMessage;
    safeStorageRemove("videoCompassActiveJob");
    elements.progress.hidden = true;
    showError(error.message || text("analysisFailed"));
    setBusy(false);
  }
}

function finishJob(job) {
  safeStorageRemove("videoCompassActiveJob");
  state.currentJob = job;
  state.currentResult = job.result;
  state.demo = false;
  const key = `${job.result.video.videoId}:${job.result.language}`;
  state.resultCache.set(key, { job, result: job.result });
  elements.url.value = job.result.video.canonicalUrl;
  elements.progressSteps.forEach((step) => { step.classList.remove("is-active"); step.classList.add("is-done"); });
  elements.progress.classList.add("is-complete");
  elements.progressTitle.textContent = text("analysisReady");
  renderResult(job, job.result);
  elements.result.scrollIntoView({ behavior: "smooth", block: "start" });
  setBusy(false);
  loadHistory();
}

async function resumeStoredJob() {
  const jobId = safeStorageGet("videoCompassActiveJob");
  if (!jobId) return;
  try {
    const payload = await statusJob(jobId);
    updateUserCredits(payload);
    if (payload.job.status === "completed") finishJob(payload.job);
    else if (!["failed", "expired", "cancelled"].includes(payload.job.status)) await runJob(payload.job);
    else safeStorageRemove("videoCompassActiveJob");
  } catch { safeStorageRemove("videoCompassActiveJob"); }
}

function clearCurrentResult() {
  state.currentJob = null;
  state.currentResult = null;
  state.demo = false;
  elements.result.hidden = true;
}

function renderResult(job, result) {
  state.currentJob = job;
  state.currentResult = result;
  elements.thumbnail.src = result.video.thumbnailUrl;
  elements.thumbnail.alt = text("videoAlt");
  elements.videoTitle.textContent = result.video.title || text("untitledVideo");
  elements.videoAuthor.textContent = result.video.author || "";
  elements.videoAuthor.hidden = !result.video.author;
  elements.videoLink.href = result.video.canonicalUrl;
  elements.overviewScore.textContent = `${result.analysis?.score ?? "-"}/100`;
  elements.overviewAbout.textContent = result.analysis?.about || "";
  const count = new Intl.NumberFormat(UI_TRANSLATIONS[state.language].locale).format(result.transcript?.originalCharacters || 0);
  elements.transcriptMeta.textContent = `${text("characters", { count })}${result.transcript?.shortened ? ` · ${text("shortened")}` : ""}`;
  elements.favorite.hidden = state.demo;
  elements.pdf.disabled = state.demo;
  elements.deleteAnalysis.hidden = state.demo;
  elements.favorite.setAttribute("aria-pressed", String(Boolean(job?.favorite)));
  elements.favorite.textContent = text(job?.favorite ? "favoriteRemove" : "favoriteAdd");
  renderAnalysis(result.analysisText, result.language, result.video.videoId);
  state.transcriptLimit = 300;
  elements.transcriptSearch.value = "";
  renderTranscript();
  renderChapters();
  switchResultTab("analysis");
  elements.result.hidden = false;
}

function appendTimecode(parent, timestamp, videoId) {
  const seconds = parseTimecode(timestamp);
  const href = seconds === null ? null : youtubeTimestampUrl(videoId, seconds);
  if (!href) return;
  const link = document.createElement("a");
  link.className = "analysis-timecode";
  link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", text("timecodeLink", { time: timestamp }));
  const icon = document.createElement("span"); icon.className = "analysis-timecode-icon"; icon.setAttribute("aria-hidden", "true"); icon.textContent = "▶";
  const label = document.createElement("span"); label.className = "analysis-timecode-label"; label.textContent = timestamp;
  link.append(icon, label); parent.append(link);
}

function appendBody(container, body, sectionNumber, videoId) {
  let list = null;
  body.split("\n").forEach((raw) => {
    const line = raw.trim();
    if (!line) { list = null; return; }
    const match = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (match) {
      if (!list) { list = document.createElement("ul"); container.append(list); }
      const item = document.createElement("li");
      const timed = sectionNumber === 2 ? match[1].match(/^\[([^\]]+)\]\s*(.*)$/) : null;
      if (timed) { appendTimecode(item, timed[1], videoId); item.append(document.createTextNode(` ${timed[2]}`)); }
      else item.textContent = match[1];
      list.append(item); return;
    }
    list = null;
    const paragraph = document.createElement("p"); paragraph.textContent = line; container.append(paragraph);
  });
}

function renderAnalysis(analysisText, language, videoId) {
  const sections = parseAnalysisSections(analysisText, language);
  elements.analysisText.replaceChildren();
  elements.analysisToolbar.hidden = sections.length === 0;
  elements.analysisText.classList.toggle("is-plain", sections.length === 0);
  if (!sections.length) { elements.analysisText.textContent = analysisText; return; }
  sections.forEach((section, index) => {
    const card = document.createElement("details"); card.className = "analysis-section is-visible"; card.open = true;
    const header = document.createElement("summary"); header.className = "analysis-section-header";
    const number = document.createElement("span"); number.className = "analysis-section-number"; number.textContent = String(section.number).padStart(2, "0");
    const title = document.createElement("span"); title.className = "analysis-section-title"; title.textContent = section.heading;
    const chevron = document.createElement("span"); chevron.className = "analysis-section-chevron"; chevron.setAttribute("aria-hidden", "true"); chevron.textContent = "⌄";
    const body = document.createElement("div"); body.className = "analysis-section-body";
    appendBody(body, section.body, section.number, videoId);
    header.append(number, title, chevron); card.append(header, body); elements.analysisText.append(card);
  });
  updateSectionControls();
}

function updateSectionControls() {
  const cards = $$("details.analysis-section");
  const opened = cards.filter((card) => card.open).length;
  elements.collapseAll.disabled = opened === 0;
  elements.expandAll.disabled = opened === cards.length;
}

function switchResultTab(tab) {
  elements.resultTabs.forEach((button) => button.setAttribute("aria-selected", String(button.dataset.resultTab === tab)));
  elements.analysisPanel.hidden = tab !== "analysis";
  elements.transcriptPanel.hidden = tab !== "transcript";
  elements.chaptersPanel.hidden = tab !== "chapters";
}

function appendHighlightedText(parent, value, query) {
  if (!query) { parent.append(document.createTextNode(value)); return; }
  const lower = value.toLocaleLowerCase(state.language);
  const needle = query.toLocaleLowerCase(state.language);
  let offset = 0;
  while (offset < value.length) {
    const found = lower.indexOf(needle, offset);
    if (found < 0) { parent.append(document.createTextNode(value.slice(offset))); break; }
    if (found > offset) parent.append(document.createTextNode(value.slice(offset, found)));
    const mark = document.createElement("mark"); mark.className = "transcript-match"; mark.textContent = value.slice(found, found + needle.length); parent.append(mark);
    offset = found + needle.length;
  }
}

function renderTranscript() {
  const segments = state.currentResult?.transcript?.segments || [];
  const query = elements.transcriptSearch.value.trim();
  const visible = segments.slice(0, query ? segments.length : state.transcriptLimit);
  elements.transcriptView.replaceChildren();
  visible.forEach((segment) => {
    const row = document.createElement("p"); row.className = "transcript-segment";
    appendTimecode(row, segment.startTimeText || formatTimecode(segment.startSeconds), state.currentResult.video.videoId);
    const span = document.createElement("span"); appendHighlightedText(span, segment.text, query); row.append(span);
    elements.transcriptView.append(row);
  });
  if (!segments.length && state.currentResult?.transcript?.text) {
    const paragraph = document.createElement("p"); appendHighlightedText(paragraph, state.currentResult.transcript.text, query); elements.transcriptView.append(paragraph);
  }
  const matches = $$("mark.transcript-match");
  state.currentMatch = matches.length ? 0 : -1;
  matches.forEach((mark, index) => mark.classList.toggle("is-current", index === 0));
  elements.transcriptCount.textContent = query ? text("matchCount", { count: matches.length }) : "";
  elements.loadMoreTranscript.hidden = query || state.transcriptLimit >= segments.length;
}

function moveMatch(direction) {
  const matches = $$("mark.transcript-match");
  if (!matches.length) return;
  matches.forEach((mark) => mark.classList.remove("is-current"));
  state.currentMatch = (state.currentMatch + direction + matches.length) % matches.length;
  matches[state.currentMatch].classList.add("is-current");
  matches[state.currentMatch].scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderChapters() {
  elements.chapters.replaceChildren();
  const chapters = state.currentResult?.analysis?.chapters || [];
  chapters.forEach((chapter) => {
    const item = document.createElement("li");
    appendTimecode(item, chapter.timestamp, state.currentResult.video.videoId);
    const title = document.createElement("span"); title.textContent = chapter.title; item.append(title); elements.chapters.append(item);
  });
  if (!chapters.length) {
    const item = document.createElement("li"); item.className = "chapters-empty"; item.textContent = text("chaptersUnavailable"); elements.chapters.append(item);
  }
}

async function loadHistory() {
  if (!state.user) return;
  try {
    const payload = await readApi(await fetch("/api/analysis/history", {
      headers: { "Accept-Language": state.language }, credentials: "same-origin",
    }));
    state.history = payload.items;
    payload.items.filter((item) => item.result?.analysisText).forEach((item) => {
      state.resultCache.set(`${item.result.video.videoId}:${item.result.language}`, { job: item, result: item.result });
    });
    renderHistory();
  } catch { /* The main analyzer remains usable if history is temporarily unavailable. */ }
}

function historyMatches(item) {
  const search = elements.historySearch.value.trim().toLocaleLowerCase(state.language);
  const result = item.result;
  if (elements.favoritesOnly.checked && !item.favorite) return false;
  if (!search) return true;
  return `${result?.video?.title || ""} ${result?.video?.canonicalUrl || ""}`.toLocaleLowerCase(state.language).includes(search);
}

function renderHistory() {
  if (!elements.historyList || !state.user) return;
  elements.historyList.replaceChildren();
  const items = state.history.filter(historyMatches);
  elements.historyEmpty.hidden = items.length > 0;
  items.forEach((item) => {
    const card = document.createElement("article"); card.className = "history-card";
    const image = document.createElement("img"); image.src = item.result?.video?.thumbnailUrl || ""; image.alt = ""; image.loading = "lazy";
    const copy = document.createElement("div");
    const title = document.createElement("h3"); title.textContent = item.result?.video?.title || text(`status_${item.status}`);
    const meta = document.createElement("p");
    const date = new Intl.DateTimeFormat(UI_TRANSLATIONS[state.language].locale, { dateStyle: "medium" }).format(new Date(item.createdAt));
    meta.textContent = `${date} · ${(item.result?.language || "").toUpperCase()}${item.result?.analysis?.score !== undefined ? ` · ${item.result.analysis.score}/100` : ""}`;
    const actions = document.createElement("div"); actions.className = "history-card-actions";
    const open = document.createElement("button"); open.type = "button"; open.textContent = item.status === "completed" ? text("openAnalysis") : text("resumeAnalysis");
    open.disabled = !["completed", "queued", "transcript_processing", "transcript_ready", "ai_processing"].includes(item.status);
    open.addEventListener("click", async () => {
      const readyLabel = item.status === "completed" ? text("openAnalysis") : text("resumeAnalysis");
      setActionBusy(open, true, text("openingAnalysis"), readyLabel);
      try {
        if (item.status === "completed") {
          const payload = await statusJob(item.id);
          state.demo = false;
          state.resultCache.set(
            `${payload.job.result.video.videoId}:${payload.job.result.language}`,
            { job: payload.job, result: payload.job.result },
          );
          renderResult(payload.job, payload.job.result);
          elements.result.scrollIntoView({ behavior: "smooth" });
        } else {
          safeStorageSet("videoCompassActiveJob", item.id);
          await runJob(item);
        }
      } catch (error) {
        showHistoryStatus(error.message || text("historyActionFailed"), true);
      } finally {
        if (open.isConnected) setActionBusy(open, false, "", readyLabel);
      }
    });
    const favorite = document.createElement("button"); favorite.type = "button"; favorite.className = "history-favorite-button"; favorite.textContent = item.favorite ? "★" : "☆"; favorite.setAttribute("aria-label", text(item.favorite ? "favoriteRemove" : "favoriteAdd")); favorite.setAttribute("aria-pressed", String(item.favorite));
    favorite.addEventListener("click", async () => {
      const readyLabel = item.favorite ? "★" : "☆";
      setActionBusy(favorite, true, "…", readyLabel);
      try {
        await toggleFavorite(item);
        showHistoryStatus(text("favoriteSaved"));
      } catch (error) {
        if (favorite.isConnected) setActionBusy(favorite, false, "", readyLabel);
        showHistoryStatus(error.message || text("historyActionFailed"), true);
      }
    });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "history-delete-button"; remove.textContent = text("deleteHistory");
    remove.addEventListener("click", async () => {
      if (!confirm(text("confirmDeleteAnalysis"))) return;
      setActionBusy(remove, true, text("deletingAnalysis"), text("deleteHistory"));
      try {
        await readApi(await fetch("/api/analysis/history", {
          method: "DELETE", headers: { "Content-Type": "application/json", "Accept-Language": state.language },
          credentials: "same-origin", body: JSON.stringify({ jobId: item.id }),
        }));
        if (state.currentJob?.id === item.id) clearCurrentResult();
        state.history = state.history.filter((historyItem) => historyItem.id !== item.id);
        card.classList.add("is-removing");
        await wait(180);
        renderHistory();
        showHistoryStatus(text("historyDeleted"));
      } catch (error) {
        if (remove.isConnected) setActionBusy(remove, false, "", text("deleteHistory"));
        showHistoryStatus(error.message || text("historyActionFailed"), true);
      }
    });
    actions.append(open, favorite, remove); copy.append(title, meta, actions); card.append(image, copy); elements.historyList.append(card);
  });
}

async function toggleFavorite(job = state.currentJob) {
  if (!job?.id || state.demo) return;
  const favorite = !job.favorite;
  const payload = await readApi(await fetch("/api/analysis/history", {
    method: "PATCH", headers: { "Content-Type": "application/json", "Accept-Language": state.language },
    credentials: "same-origin", body: JSON.stringify({ jobId: job.id, favorite }),
  }));
  job.favorite = payload.favorite;
  if (state.currentJob?.id === job.id) {
    state.currentJob.favorite = payload.favorite;
    elements.favorite.setAttribute("aria-pressed", String(payload.favorite));
    elements.favorite.textContent = text(payload.favorite ? "favoriteRemove" : "favoriteAdd");
  }
  await loadHistory();
  return payload.favorite;
}

async function deleteCurrentAnalysis() {
  if (!state.currentJob?.id || state.demo || !confirm(text("confirmDeleteAnalysis"))) return;
  await readApi(await fetch("/api/analysis/history", {
    method: "DELETE", headers: { "Content-Type": "application/json", "Accept-Language": state.language },
    credentials: "same-origin", body: JSON.stringify({ jobId: state.currentJob.id }),
  }));
  clearCurrentResult(); await loadHistory();
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function demoResult() {
  const content = {
    ru: { about: "Пример показывает, как сервис превращает длинное видео в навигацию по главным идеям.", ideas: ["Определите цель просмотра", "Переходите сразу к нужному фрагменту", "Закрепите выводы практическим действием"], audience: "Тем, кто учится по YouTube и экономит время.", action: "Выберите один вывод и примените его сегодня.", doubt: "Это демонстрационный результат, а не анализ реального ролика.", questions: ["Какова главная идея?", "Какой фрагмент полезнее всего?", "Что вы примените?"] },
    en: { about: "This example shows how the service turns a long video into navigation through its main ideas.", ideas: ["Define your viewing goal", "Jump directly to the useful segment", "Turn conclusions into an action"], audience: "People who learn from YouTube and value their time.", action: "Choose one conclusion and apply it today.", doubt: "This is a demo result, not an analysis of a real video.", questions: ["What is the main idea?", "Which segment is most useful?", "What will you apply?"] },
    lv: { about: "Šis piemērs parāda, kā pakalpojums pārvērš garu video galveno ideju navigācijā.", ideas: ["Nosakiet skatīšanās mērķi", "Pārejiet tieši uz noderīgo fragmentu", "Pārvērtiet secinājumu darbībā"], audience: "Cilvēkiem, kuri mācās no YouTube un taupa laiku.", action: "Izvēlieties vienu secinājumu un izmantojiet to šodien.", doubt: "Šis ir demonstrācijas rezultāts, nevis īsta video analīze.", questions: ["Kāda ir galvenā ideja?", "Kurš fragments ir visnoderīgākais?", "Ko jūs izmantosiet?"] },
  }[state.language];
  const analysis = {
    about: content.about,
    summary: ["00:18", "01:42", "03:10", "05:26", "08:04"].map((timestamp, index) => ({ timestamp, text: content.ideas[index % content.ideas.length] })),
    keyIdeas: content.ideas, audience: content.audience, score: 88, scoreExplanation: content.about,
    actions: [content.action, ...content.ideas.slice(0, 2)], doubts: [content.doubt], selfCheck: content.questions,
    chapters: ["00:18", "01:42", "03:10", "05:26", "08:04"].map((timestamp, index) => ({
      timestamp,
      title: content.ideas[index % content.ideas.length],
    })),
  };
  const headings = ANALYSIS_HEADINGS[state.language];
  const bodies = [analysis.about, analysis.summary.map((item) => `- [${item.timestamp}] ${item.text}`).join("\n"), analysis.keyIdeas.map((item) => `- ${item}`).join("\n"), analysis.audience, `${analysis.score}/100. ${analysis.scoreExplanation}`, analysis.actions.map((item) => `- ${item}`).join("\n"), `- ${analysis.doubts[0]}`, analysis.selfCheck.map((item, index) => `${index + 1}. ${item}`).join("\n")];
  const analysisText = headings.map((heading, index) => `${index + 1}. ${heading}\n${bodies[index]}`).join("\n\n");
  return { language: state.language, video: { videoId: "dQw4w9WgXcQ", canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", title: text("demoVideoTitle"), author: "VideoCompass AI" }, analysis, analysisText, transcript: { text: content.about, segments: analysis.summary.map((item) => ({ startTimeText: item.timestamp, startSeconds: parseTimecode(item.timestamp), text: item.text })), originalCharacters: 1240, sentCharacters: 1240, shortened: false } };
}

function showDemo() {
  state.demo = true;
  const result = demoResult();
  renderResult({ id: null, favorite: false }, result);
  state.demo = true;
  elements.result.scrollIntoView({ behavior: "smooth" });
}

async function changeLanguage(language) {
  if (language === state.language || state.analyzing) return;
  const oldResult = state.currentResult;
  translatePage(language);
  if (!oldResult) return;
  if (state.demo) { showDemo(); return; }
  const cached = state.resultCache.get(`${oldResult.video.videoId}:${language}`);
  if (cached) { renderResult(cached.job, cached.result); return; }
  if (!confirm(text("languageCreditWarning"))) return;
  await startAnalysis(oldResult.video.canonicalUrl);
}

async function deleteAccount(event) {
  event.preventDefault();
  const password = elements.deleteAccountPassword.value;
  if (password.length < 8) return;
  if (state.config.captchaRequired && !state.deleteCaptchaToken) {
    elements.deleteAccountError.textContent = text("captchaRequired");
    elements.deleteAccountError.hidden = false;
    return;
  }
  elements.deleteAccountError.hidden = true;
  try {
    await readApi(await fetch("/api/account/delete", {
      method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": state.language },
      credentials: "same-origin", body: JSON.stringify({ password, captchaToken: state.deleteCaptchaToken }),
    }));
    elements.deleteAccountDialog.close();
    state.user = null; state.history = []; state.resultCache.clear(); clearCurrentResult(); renderAuthState();
  } catch (error) {
    elements.deleteAccountError.textContent = error.message; elements.deleteAccountError.hidden = false;
    resetDeleteCaptcha();
  }
}

function closeExportMenu({ returnFocus = false } = {}) {
  if (!elements.exportMenu.open) return;
  elements.exportMenu.open = false;
  if (returnFocus) elements.exportMenu.querySelector("summary")?.focus();
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = elements.url.value.trim();
  if (!parseVideoId(value)) { showError(text("invalidUrl")); elements.url.focus(); return; }
  clearError(); startAnalysis(value);
});
elements.openAuth.addEventListener("click", () => openAuth("login"));
elements.gateAuth.addEventListener("click", () => openAuth("login"));
elements.closeAuth.addEventListener("click", () => { if (!state.authSubmitting) elements.authDialog.close(); });
elements.authModes.forEach((button) => button.addEventListener("click", () => { state.authMode = button.dataset.authMode; renderAuthMode(); resetCaptcha(); }));
elements.authForm.addEventListener("submit", (event) => { event.preventDefault(); submitAuth(); });
elements.togglePassword.addEventListener("click", () => { const visible = elements.authPassword.type === "text"; elements.authPassword.type = visible ? "password" : "text"; elements.togglePassword.textContent = text(visible ? "showPassword" : "hidePassword"); });
elements.logout.addEventListener("click", logout);
elements.languageButton.addEventListener("click", () => setLanguageMenuOpen(elements.languageMenu.hidden));
elements.languageButton.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  setLanguageMenuOpen(true, { focusSelected: true });
});
elements.languageOptions.forEach((option) => option.addEventListener("click", async () => {
  setLanguageMenuOpen(false, { returnFocus: true });
  await changeLanguage(option.dataset.languageOption);
}));
elements.languageMenu.addEventListener("keydown", (event) => {
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    moveLanguageOptionFocus(event.key);
  }
});
elements.resultTabs.forEach((button) => button.addEventListener("click", () => switchResultTab(button.dataset.resultTab)));
elements.resultTabs.forEach((button, index) => button.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const targetIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? elements.resultTabs.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + elements.resultTabs.length) % elements.resultTabs.length;
  elements.resultTabs[targetIndex].focus();
  switchResultTab(elements.resultTabs[targetIndex].dataset.resultTab);
}));
elements.collapseAll.addEventListener("click", () => { $$("details.analysis-section").forEach((card) => { card.open = false; }); updateSectionControls(); });
elements.expandAll.addEventListener("click", () => { $$("details.analysis-section").forEach((card) => { card.open = true; }); updateSectionControls(); });
elements.analysisText.addEventListener("toggle", updateSectionControls, true);
elements.transcriptSearch.addEventListener("input", renderTranscript);
elements.previousMatch.addEventListener("click", () => moveMatch(-1));
elements.nextMatch.addEventListener("click", () => moveMatch(1));
elements.loadMoreTranscript.addEventListener("click", () => { state.transcriptLimit += 300; renderTranscript(); });
elements.favorite.addEventListener("click", () => toggleFavorite());
elements.copy.addEventListener("click", async () => { if (!state.currentResult) return; await navigator.clipboard.writeText(state.currentResult.analysisText); elements.copy.textContent = text("copied"); setTimeout(() => { elements.copy.textContent = text("copyButton"); }, 1400); });
elements.textDownload.addEventListener("click", () => { if (!state.currentResult) return; download("videocompass-analysis.txt", state.currentResult.analysisText, "text/plain;charset=utf-8"); });
elements.markdown.addEventListener("click", () => { if (!state.currentResult) return; download("videocompass-analysis.md", structuredAnalysisToMarkdown(state.currentResult.analysis, state.currentResult.language, state.currentResult.video), "text/markdown;charset=utf-8"); });
elements.pdf.addEventListener("click", () => { if (state.currentJob?.id && !state.demo) window.location.assign(`/api/export/pdf?jobId=${encodeURIComponent(state.currentJob.id)}`); });
elements.deleteAnalysis.addEventListener("click", deleteCurrentAnalysis);
elements.exportMenu.querySelector(".export-menu-popover").addEventListener("click", (event) => {
  if (event.target.closest("button")) closeExportMenu();
});
document.addEventListener("pointerdown", (event) => {
  if (elements.exportMenu.open && !elements.exportMenu.contains(event.target)) closeExportMenu();
  if (!elements.languageMenu.hidden && !elements.languageMenu.parentElement.contains(event.target)) {
    setLanguageMenuOpen(false);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.exportMenu.open) closeExportMenu({ returnFocus: true });
  if (event.key === "Escape" && !elements.languageMenu.hidden) setLanguageMenuOpen(false, { returnFocus: true });
});
elements.newAnalysis.addEventListener("click", () => { clearCurrentResult(); elements.url.focus(); $("#analyzer").scrollIntoView({ behavior: "smooth" }); });
elements.historyButton.addEventListener("click", () => elements.historySection.scrollIntoView({ behavior: "smooth" }));
[elements.historySearch, elements.favoritesOnly].forEach((control) => control.addEventListener("input", renderHistory));
elements.demo.addEventListener("click", showDemo);
elements.deleteAccount.addEventListener("click", () => { elements.deleteAccountDialog.showModal(); renderDeleteTurnstile(); });
elements.cancelDeleteAccount.addEventListener("click", () => { elements.deleteAccountDialog.close(); resetDeleteCaptcha(); });
elements.deleteAccountForm.addEventListener("submit", deleteAccount);

translatePage(state.language);
loadConfig();
loadSession();
