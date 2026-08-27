import {
  detectPreferredLanguage,
  UI_TRANSLATIONS,
  uiText,
} from "./lib/ui-translations.js";
import { parseAnalysisSections } from "./lib/analysis-sections.js";

const form = document.querySelector("#analyzerForm");
const urlInput = document.querySelector("#youtubeUrl");
const submitButton = document.querySelector("#submitButton");
const submitButtonLabel = submitButton.querySelector("span");
const languageButtons = [...document.querySelectorAll("[data-language]")];
const errorMessage = document.querySelector("#errorMessage");
const errorText = document.querySelector("#errorText");
const progressPanel = document.querySelector("#progressPanel");
const progressTitle = document.querySelector("#progressTitle");
const progressSteps = [
  document.querySelector("#progressStep1"),
  document.querySelector("#progressStep2"),
  document.querySelector("#progressStep3"),
];
const result = document.querySelector("#result");
const videoThumbnail = document.querySelector("#videoThumbnail");
const videoLink = document.querySelector("#videoLink");
const transcriptMeta = document.querySelector("#transcriptMeta");
const analysisText = document.querySelector("#analysisText");
const analysisToolbar = document.querySelector("#analysisToolbar");
const collapseAllButton = document.querySelector("#collapseAllButton");
const expandAllButton = document.querySelector("#expandAllButton");
const copyButton = document.querySelector("#copyButton");
const newAnalysisButton = document.querySelector("#newAnalysisButton");
const openAuthButton = document.querySelector("#openAuthButton");
const gateAuthButton = document.querySelector("#gateAuthButton");
const authGate = document.querySelector("#authGate");
const authGateTitle = document.querySelector("#authGateTitle");
const authGateText = document.querySelector("#authGateText");
const userPanel = document.querySelector("#userPanel");
const userEmail = document.querySelector("#userEmail");
const creditBadge = document.querySelector("#creditBadge");
const logoutButton = document.querySelector("#logoutButton");
const authDialog = document.querySelector("#authDialog");
const closeAuthButton = document.querySelector("#closeAuthButton");
const authForm = document.querySelector("#authForm");
const authEmail = document.querySelector("#authEmail");
const authPassword = document.querySelector("#authPassword");
const authError = document.querySelector("#authError");
const authSubmitButton = document.querySelector("#authSubmitButton");
const authSubmitLabel = authSubmitButton.querySelector("span");
const authModeButtons = [...document.querySelectorAll("[data-auth-mode]")];

// Временно: во время проверки преподавателем каждое новое открытие начинается на русском.
const REVIEW_DEFAULT_LANGUAGE = "ru";

function storedLanguage() {
  try {
    return localStorage.getItem("videoCompassLanguage");
  } catch {
    return null;
  }
}

let currentLanguage = detectPreferredLanguage({
  forcedLanguage: REVIEW_DEFAULT_LANGUAGE,
  storedLanguage: storedLanguage(),
  browserLanguages: navigator.languages || [navigator.language],
});
let cooldownTimer = null;
let cooldownRemaining = 0;
let isAnalyzing = false;
let activeProgressIndex = 0;
let activeVideoId = null;
let lastAnalyzedUrl = "";
let currentPayload = null;
const resultCache = new Map();
let analysisSectionObserver = null;
let currentUser = null;
let sessionLoading = true;
let authMode = "login";
let authSubmitting = false;

function saveLanguage(language) {
  try {
    localStorage.setItem("videoCompassLanguage", language);
  } catch {
    // The selected language still works when storage is unavailable.
  }
}

function text(key, params = {}) {
  return uiText(currentLanguage, key, params);
}

function setLanguageControlsDisabled(disabled) {
  languageButtons.forEach((button) => {
    button.disabled = disabled;
  });
}

function renderSubmitState() {
  if (isAnalyzing) {
    submitButton.disabled = true;
    submitButtonLabel.textContent = text("analyzing");
    return;
  }

  if (cooldownRemaining > 0) {
    submitButton.disabled = true;
    submitButtonLabel.textContent = text("repeat", { seconds: cooldownRemaining });
    return;
  }

  if (sessionLoading || !currentUser || currentUser.credits <= 0) {
    submitButton.disabled = true;
    submitButtonLabel.textContent = text("analyzeButton");
    return;
  }

  submitButton.disabled = false;
  submitButtonLabel.textContent = text("analyzeButton");
}

function renderAuthMode() {
  authModeButtons.forEach((button) => {
    const selected = button.dataset.authMode === authMode;
    button.setAttribute("aria-selected", String(selected));
    button.classList.toggle("is-active", selected);
  });
  authPassword.autocomplete = authMode === "register" ? "new-password" : "current-password";
  authSubmitLabel.textContent = authSubmitting
    ? text(authMode === "register" ? "registerSubmitting" : "loginSubmitting")
    : text(authMode === "register" ? "register" : "signIn");
  authSubmitButton.disabled = authSubmitting;
}

function renderAuthState() {
  const authenticated = Boolean(currentUser);
  const noCredits = authenticated && currentUser.credits <= 0;

  openAuthButton.hidden = authenticated;
  userPanel.hidden = !authenticated;
  userEmail.textContent = currentUser?.email || "";
  creditBadge.textContent = authenticated
    ? text("creditsCount", { count: currentUser.credits })
    : "";
  creditBadge.title = authenticated
    ? text("creditsTitle", { count: currentUser.credits })
    : "";

  authGate.hidden = authenticated && !noCredits;
  gateAuthButton.hidden = authenticated;
  authGateTitle.textContent = text(noCredits ? "noCreditsTitle" : "authGateTitle");
  authGateText.textContent = text(noCredits ? "noCreditsText" : "authGateText");
  form.classList.toggle("is-locked", !authenticated || noCredits);
  urlInput.disabled = sessionLoading || !authenticated || noCredits;
  renderSubmitState();
}

function translatePage(language) {
  currentLanguage = language;
  saveLanguage(language);

  const dictionary = UI_TRANSLATIONS[language];
  document.documentElement.lang = language;
  document.title = dictionary.metaTitle;
  document.querySelector('meta[name="description"]').content = dictionary.metaDescription;
  document.querySelector('meta[property="og:description"]').content = dictionary.ogDescription;

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    const value = dictionary[key];
    if (typeof value === "string") {
      element.textContent = value;
    }
  });

  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    const value = dictionary[element.dataset.i18nAriaLabel];
    if (typeof value === "string") {
      element.setAttribute("aria-label", value);
    }
  });

  languageButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.language === language));
  });

  if (!progressPanel.hidden) {
    updateProgress(activeProgressIndex);
  }
  renderAuthMode();
  renderAuthState();
}

function parseYouTubeVideoId(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      !["youtu.be", "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(
        host,
      ) ||
      !["http:", "https:"].includes(url.protocol)
    ) {
      return null;
    }

    let videoId = "";
    if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] || "";
    } else if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v") || "";
    } else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "live", "embed"].includes(parts[0])) {
        videoId = parts[1] || "";
      }
    }

    return /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : null;
  } catch {
    return null;
  }
}

function looksLikeYouTubeUrl(value) {
  return Boolean(parseYouTubeVideoId(value));
}

function showError(message) {
  errorText.textContent = message;
  errorMessage.hidden = false;
  urlInput.setAttribute("aria-invalid", "true");
}

function clearError() {
  errorText.textContent = "";
  errorMessage.hidden = true;
  urlInput.removeAttribute("aria-invalid");
}

function openAuthDialog(mode = "login") {
  authMode = mode;
  authError.hidden = true;
  authError.textContent = "";
  renderAuthMode();
  authDialog.showModal();
  setTimeout(() => authEmail.focus(), 0);
}

function closeAuthDialog() {
  if (authSubmitting) return;
  authDialog.close();
}

async function readApiResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(text("invalidResponse"));
  }
  if (!response.ok || !payload.ok) {
    const error = new Error(payload?.error?.message || text("unexpected"));
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

async function loadSession({ silent = false } = {}) {
  const previousUser = currentUser;
  try {
    const response = await fetch("/api/auth/session", {
      headers: { "Accept-Language": currentLanguage },
      credentials: "same-origin",
    });
    const payload = await readApiResponse(response);
    currentUser = payload.authenticated ? payload.user : null;
  } catch (error) {
    currentUser = silent ? previousUser : null;
    if (!silent) showError(error?.message || text("sessionError"));
  } finally {
    sessionLoading = false;
    renderAuthState();
  }
}

async function submitAuth() {
  const email = authEmail.value.trim();
  const password = authPassword.value;
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    authError.textContent = text("invalidEmail");
    authError.hidden = false;
    authEmail.focus();
    return;
  }
  if (password.length < 8 || password.length > 128) {
    authError.textContent = text("invalidPassword");
    authError.hidden = false;
    authPassword.focus();
    return;
  }

  authSubmitting = true;
  authError.hidden = true;
  renderAuthMode();
  try {
    const response = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": currentLanguage,
      },
      credentials: "same-origin",
      body: JSON.stringify({ email, password, language: currentLanguage }),
    });
    const payload = await readApiResponse(response);
    currentUser = payload.user;
    authPassword.value = "";
    authDialog.close();
    clearError();
    renderAuthState();
    urlInput.focus();
  } catch (error) {
    authError.textContent = error?.message || text("unexpected");
    authError.hidden = false;
  } finally {
    authSubmitting = false;
    renderAuthMode();
  }
}

async function logout() {
  logoutButton.disabled = true;
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Accept-Language": currentLanguage },
      credentials: "same-origin",
    });
  } finally {
    currentUser = null;
    clearVideoState();
    clearError();
    logoutButton.disabled = false;
    renderAuthState();
  }
}

function createRequestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function updateProgress(activeIndex) {
  activeProgressIndex = activeIndex;
  const titles = [text("progressOne"), text("progressTwo"), text("progressThree")];
  progressTitle.textContent = titles[Math.min(activeIndex, titles.length - 1)];

  progressSteps.forEach((step, index) => {
    step.classList.toggle("is-done", index < activeIndex);
    step.classList.toggle("is-active", index === activeIndex);
  });
}

function startCooldown(seconds = 5) {
  clearInterval(cooldownTimer);
  cooldownRemaining = seconds;
  renderSubmitState();

  cooldownTimer = setInterval(() => {
    cooldownRemaining -= 1;
    if (cooldownRemaining <= 0) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      cooldownRemaining = 0;
    }
    renderSubmitState();
  }, 1_000);
}

function formatCharacters(value) {
  return new Intl.NumberFormat(UI_TRANSLATIONS[currentLanguage].locale).format(value);
}

function appendAnalysisBody(container, body) {
  let activeList = null;

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      activeList = null;
      continue;
    }

    const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
    const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (bulletMatch || numberedMatch) {
      const listTag = numberedMatch ? "ol" : "ul";
      if (!activeList || activeList.tagName.toLowerCase() !== listTag) {
        activeList = document.createElement(listTag);
        container.append(activeList);
      }

      const item = document.createElement("li");
      item.textContent = (bulletMatch || numberedMatch)[1];
      activeList.append(item);
      continue;
    }

    activeList = null;
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    container.append(paragraph);
  }
}

function analysisSections() {
  return [...analysisText.querySelectorAll("details.analysis-section")];
}

function updateAnalysisControls() {
  const sections = analysisSections();
  const openSections = sections.filter((section) => section.open).length;
  collapseAllButton.disabled = openSections === 0;
  expandAllButton.disabled = openSections === sections.length;
}

function revealAnalysisSections(sections) {
  analysisSectionObserver?.disconnect();

  if (!("IntersectionObserver" in window)) {
    sections.forEach((section) => section.classList.add("is-visible"));
    return;
  }

  analysisSectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add("is-visible");
        analysisSectionObserver.unobserve(entry.target);
      });
    },
    { threshold: 0.08, rootMargin: "0px 0px -7% 0px" },
  );

  sections.forEach((section) => analysisSectionObserver.observe(section));
}

function renderAnalysis(analysis, language) {
  const sections = parseAnalysisSections(analysis, language);
  analysisText.replaceChildren();
  analysisText.classList.toggle("is-plain", sections.length === 0);
  analysisToolbar.hidden = sections.length === 0;

  if (!sections.length) {
    analysisText.textContent = analysis;
    return;
  }

  sections.forEach((section, index) => {
    const card = document.createElement("details");
    card.className = "analysis-section";
    card.open = true;
    card.style.setProperty("--section-delay", `${(index % 3) * 70}ms`);
    card.addEventListener("toggle", updateAnalysisControls);

    const header = document.createElement("summary");
    header.className = "analysis-section-header";

    const number = document.createElement("span");
    number.className = "analysis-section-number";
    number.textContent = String(section.number).padStart(2, "0");

    const title = document.createElement("span");
    title.className = "analysis-section-title";
    title.textContent = section.heading;

    const chevron = document.createElement("span");
    chevron.className = "analysis-section-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "⌄";

    header.append(number, title, chevron);

    const body = document.createElement("div");
    body.className = "analysis-section-body";
    appendAnalysisBody(body, section.body);

    card.append(header, body);
    analysisText.append(card);
  });

  const cards = analysisSections();
  updateAnalysisControls();
  revealAnalysisSections(cards);
}

function renderResult(payload) {
  currentPayload = payload;
  videoThumbnail.src = payload.video.thumbnailUrl;
  videoThumbnail.alt = text("videoAlt");
  videoLink.href = payload.video.canonicalUrl;
  renderAnalysis(payload.analysis, payload.language || currentLanguage);

  const metaParts = [
    text("characters", {
      count: formatCharacters(payload.transcript.originalCharacters),
    }),
  ];
  if (payload.transcript.shortened) {
    metaParts.push(text("shortened"));
  }
  transcriptMeta.textContent = metaParts.join(" · ");

  result.hidden = false;
}

function clearVideoState() {
  activeVideoId = null;
  lastAnalyzedUrl = "";
  currentPayload = null;
  resultCache.clear();
  result.hidden = true;
}

async function analyzeVideo(youtubeUrl, language, { scrollToResult = true } = {}) {
  clearError();
  currentPayload = null;
  result.hidden = true;
  progressPanel.hidden = false;
  form.setAttribute("aria-busy", "true");
  isAnalyzing = true;
  setLanguageControlsDisabled(true);
  renderSubmitState();
  updateProgress(0);

  const stageTwoTimer = setTimeout(() => updateProgress(1), 700);
  const stageThreeTimer = setTimeout(() => updateProgress(2), 4_500);
  const controller = new AbortController();
  const requestTimeout = setTimeout(() => controller.abort(), 125_000);
  let succeeded = false;

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": language,
      },
      credentials: "same-origin",
      body: JSON.stringify({ youtubeUrl, language, requestId: createRequestId() }),
      signal: controller.signal,
    });

    const payload = await readApiResponse(response);

    if (activeVideoId && activeVideoId !== payload.video.videoId) {
      resultCache.clear();
    }
    activeVideoId = payload.video.videoId;
    lastAnalyzedUrl = payload.video.canonicalUrl;
    resultCache.set(language, payload);
    currentUser = {
      ...currentUser,
      credits: payload.creditsRemaining,
      nextResetAt: payload.nextResetAt,
    };
    renderAuthState();

    progressSteps.forEach((step) => {
      step.classList.remove("is-active");
      step.classList.add("is-done");
    });
    progressTitle.textContent = text("analysisReady");
    renderResult(payload);
    if (scrollToResult) {
      result.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    succeeded = true;
  } catch (error) {
    if (error?.code === "AUTH_REQUIRED") {
      currentUser = null;
      renderAuthState();
    }
    if (error?.name === "AbortError") {
      showError(text("timeout"));
    } else if (
      /load failed|failed to fetch|networkerror|network request failed/i.test(error?.message || "")
    ) {
      showError(text("network"));
    } else {
      showError(error?.message || text("unexpected"));
    }
  } finally {
    clearTimeout(stageTwoTimer);
    clearTimeout(stageThreeTimer);
    clearTimeout(requestTimeout);
    progressPanel.hidden = true;
    form.removeAttribute("aria-busy");
    isAnalyzing = false;
    setLanguageControlsDisabled(false);
    startCooldown();
    if (!succeeded && currentUser) {
      await loadSession({ silent: true });
    }
  }

  return succeeded;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  if (!currentUser) {
    openAuthDialog("login");
    return;
  }
  if (currentUser.credits <= 0) {
    showError(text("noCreditsText"));
    return;
  }

  const youtubeUrl = urlInput.value.trim();
  if (!looksLikeYouTubeUrl(youtubeUrl)) {
    showError(text("invalidUrl"));
    urlInput.focus();
    return;
  }

  const requestedVideoId = parseYouTubeVideoId(youtubeUrl);
  if (activeVideoId && requestedVideoId !== activeVideoId) {
    clearVideoState();
  }

  const cached = requestedVideoId === activeVideoId ? resultCache.get(currentLanguage) : null;
  if (cached) {
    renderResult(cached);
    result.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  await analyzeVideo(youtubeUrl, currentLanguage);
});

languageButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const language = button.dataset.language;
    if (language === currentLanguage || isAnalyzing) {
      return;
    }

    clearError();
    translatePage(language);

    if (!activeVideoId || !lastAnalyzedUrl) {
      return;
    }

    const cached = resultCache.get(language);
    if (cached) {
      renderResult(cached);
      return;
    }

    if (!currentUser) {
      openAuthDialog("login");
      return;
    }
    if (currentUser.credits <= 0) {
      showError(text("noCreditsText"));
      return;
    }

    urlInput.value = lastAnalyzedUrl;
    await analyzeVideo(lastAnalyzedUrl, language, { scrollToResult: false });
  });
});

collapseAllButton.addEventListener("click", () => {
  analysisSections().forEach((section) => {
    section.open = false;
  });
  updateAnalysisControls();
});

expandAllButton.addEventListener("click", () => {
  analysisSections().forEach((section) => {
    section.open = true;
  });
  updateAnalysisControls();
});

urlInput.addEventListener("input", clearError);

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(currentPayload?.analysis || analysisText.textContent);
    copyButton.textContent = text("copied");
    setTimeout(() => {
      copyButton.textContent = text("copyButton");
    }, 1_800);
  } catch {
    copyButton.textContent = text("copyFailed");
  }
});

newAnalysisButton.addEventListener("click", () => {
  clearVideoState();
  clearError();
  urlInput.value = "";
  urlInput.focus();
  document.querySelector("#analyzer").scrollIntoView({ behavior: "smooth" });
});

openAuthButton.addEventListener("click", () => openAuthDialog("login"));
gateAuthButton.addEventListener("click", () => openAuthDialog("register"));
closeAuthButton.addEventListener("click", closeAuthDialog);
logoutButton.addEventListener("click", logout);

authModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    authMode = button.dataset.authMode;
    authError.hidden = true;
    renderAuthMode();
    authEmail.focus();
  });
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const index = authModeButtons.indexOf(button);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = authModeButtons[(index + direction + authModeButtons.length) % authModeButtons.length];
    next.click();
    next.focus();
  });
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authSubmitting) await submitAuth();
});

authDialog.addEventListener("click", (event) => {
  if (event.target === authDialog) closeAuthDialog();
});

translatePage(currentLanguage);
renderAuthState();
loadSession();
