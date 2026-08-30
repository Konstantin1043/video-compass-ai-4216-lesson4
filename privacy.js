import { detectPreferredLanguage } from "./lib/ui-translations.js";

const languageSelect = document.querySelector("#privacyLanguageSelect");
const content = [...document.querySelectorAll("[data-privacy-content]")];
function stored() { try { return localStorage.getItem("videoCompassLanguage"); } catch { return null; } }
function select(language) {
  document.documentElement.lang = language;
  content.forEach((article) => { article.hidden = article.dataset.privacyContent !== language; });
  languageSelect.value = language;
  try { localStorage.setItem("videoCompassLanguage", language); } catch { /* Ignore. */ }
}
languageSelect.addEventListener("change", () => select(languageSelect.value));
select(detectPreferredLanguage({ storedLanguage: stored(), browserLanguages: navigator.languages || [navigator.language] }));
fetch("/api/config").then((response) => response.json()).then((config) => {
  const contact = document.querySelector("#privacyContact");
  const parts = [config.controllerName, config.contactEmail].filter(Boolean);
  contact.textContent = parts.length ? parts.join(" · ") : "VideoCompass AI";
}).catch(() => {});
