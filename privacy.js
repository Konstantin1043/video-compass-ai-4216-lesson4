import { detectPreferredLanguage } from "./lib/ui-translations.js";

const languageButton = document.querySelector("#privacyLanguageMenuButton");
const languageCurrent = document.querySelector("#privacyLanguageCurrent");
const languageMenu = document.querySelector("#privacyLanguageMenu");
const languageOptions = [...document.querySelectorAll("[data-privacy-language-option]")];
const content = [...document.querySelectorAll("[data-privacy-content]")];
function stored() { try { return localStorage.getItem("videoCompassLanguage"); } catch { return null; } }
function select(language) {
  document.documentElement.lang = language;
  content.forEach((article) => { article.hidden = article.dataset.privacyContent !== language; });
  languageCurrent.textContent = language.toUpperCase();
  languageOptions.forEach((option) => {
    option.setAttribute("aria-selected", String(option.dataset.privacyLanguageOption === language));
  });
  try { localStorage.setItem("videoCompassLanguage", language); } catch { /* Ignore. */ }
}

function setLanguageMenuOpen(open, { focusSelected = false, returnFocus = false } = {}) {
  languageMenu.hidden = !open;
  languageButton.setAttribute("aria-expanded", String(open));
  if (open && focusSelected) {
    const selected = languageOptions.find((option) => option.getAttribute("aria-selected") === "true");
    (selected || languageOptions[0])?.focus();
  }
  if (!open && returnFocus) languageButton.focus();
}

function moveLanguageOptionFocus(key) {
  const currentIndex = Math.max(0, languageOptions.indexOf(document.activeElement));
  const targetIndex = key === "Home"
    ? 0
    : key === "End"
      ? languageOptions.length - 1
      : (currentIndex + (key === "ArrowDown" ? 1 : -1) + languageOptions.length) % languageOptions.length;
  languageOptions[targetIndex]?.focus();
}

languageButton.addEventListener("click", () => setLanguageMenuOpen(languageMenu.hidden));
languageButton.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  setLanguageMenuOpen(true, { focusSelected: true });
});
languageOptions.forEach((option) => option.addEventListener("click", () => {
  select(option.dataset.privacyLanguageOption);
  setLanguageMenuOpen(false, { returnFocus: true });
}));
languageMenu.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  moveLanguageOptionFocus(event.key);
});
document.addEventListener("pointerdown", (event) => {
  if (!languageMenu.hidden && !languageMenu.parentElement.contains(event.target)) setLanguageMenuOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !languageMenu.hidden) setLanguageMenuOpen(false, { returnFocus: true });
});
select(detectPreferredLanguage({ storedLanguage: stored(), browserLanguages: navigator.languages || [navigator.language] }));
fetch("/api/config").then((response) => response.json()).then((config) => {
  const contact = document.querySelector("#privacyContact");
  const parts = [config.controllerName, config.contactEmail].filter(Boolean);
  contact.textContent = parts.length ? parts.join(" · ") : "VideoCompass AI";
}).catch(() => {});
