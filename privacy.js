import { detectPreferredLanguage } from "./lib/ui-translations.js";

const buttons = [...document.querySelectorAll("[data-privacy-language]")];
const content = [...document.querySelectorAll("[data-privacy-content]")];
function stored() { try { return localStorage.getItem("videoCompassLanguage"); } catch { return null; } }
function select(language) {
  document.documentElement.lang = language;
  content.forEach((article) => { article.hidden = article.dataset.privacyContent !== language; });
  buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.privacyLanguage === language)));
  try { localStorage.setItem("videoCompassLanguage", language); } catch { /* Ignore. */ }
}
buttons.forEach((button) => button.addEventListener("click", () => select(button.dataset.privacyLanguage)));
select(detectPreferredLanguage({ storedLanguage: stored(), browserLanguages: navigator.languages || [navigator.language] }));
fetch("/api/config").then((response) => response.json()).then((config) => {
  const contact = document.querySelector("#privacyContact");
  const parts = [config.controllerName, config.contactEmail].filter(Boolean);
  contact.textContent = parts.length ? parts.join(" · ") : "VideoCompass AI";
}).catch(() => {});

