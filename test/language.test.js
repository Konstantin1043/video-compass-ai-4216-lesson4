import assert from "node:assert/strict";
import test from "node:test";
import {
  languageFromAcceptLanguage,
  normalizeLanguage,
  serverMessage,
} from "../lib/language.js";
import {
  detectPreferredLanguage,
  UI_TRANSLATIONS,
  uiText,
} from "../lib/ui-translations.js";

test("нормализует поддерживаемые языки", () => {
  assert.equal(normalizeLanguage("ru-RU"), "ru");
  assert.equal(normalizeLanguage("EN-us"), "en");
  assert.equal(normalizeLanguage("lv"), "lv");
  assert.equal(normalizeLanguage("de-DE"), null);
});

test("выбирает сохранённый язык раньше языка браузера", () => {
  assert.equal(
    detectPreferredLanguage({
      storedLanguage: "lv",
      browserLanguages: ["ru-RU", "en-US"],
    }),
    "lv",
  );
});

test("временно выбирает русский для проверки преподавателем", () => {
  assert.equal(
    detectPreferredLanguage({
      forcedLanguage: "ru",
      storedLanguage: "en",
      browserLanguages: ["lv-LV"],
    }),
    "ru",
  );
});

test("использует язык браузера и английский резервный вариант", () => {
  assert.equal(
    detectPreferredLanguage({ browserLanguages: ["de-DE", "ru-RU"] }),
    "ru",
  );
  assert.equal(detectPreferredLanguage({ browserLanguages: ["de-DE"] }), "en");
});

test("читает первый поддерживаемый язык из Accept-Language", () => {
  assert.equal(languageFromAcceptLanguage("de-DE,de;q=0.9,lv;q=0.8"), "lv");
  assert.equal(languageFromAcceptLanguage(null), "ru");
});

test("UI-словари содержат одинаковый набор непустых ключей", () => {
  const expectedKeys = Object.keys(UI_TRANSLATIONS.en).sort();

  for (const language of ["ru", "en", "lv"]) {
    assert.deepEqual(Object.keys(UI_TRANSLATIONS[language]).sort(), expectedKeys);
    for (const value of Object.values(UI_TRANSLATIONS[language])) {
      assert.ok(typeof value === "function" || (typeof value === "string" && value.length > 0));
    }
  }
});

test("описание процесса ориентировано на пользователя во всех языках", () => {
  for (const language of ["ru", "en", "lv"]) {
    assert.doesNotMatch(UI_TRANSLATIONS[language].processTwoText, /секрет|secret|slepen/i);
  }
  assert.equal(
    UI_TRANSLATIONS.ru.processThreeText,
    "Gemini анализирует транскрипт по заданным параметрам.",
  );
});

test("кнопка экспорта имеет короткое название во всех языках", () => {
  assert.equal(UI_TRANSLATIONS.ru.exportMenu, "Экспорт");
  assert.equal(UI_TRANSLATIONS.en.exportMenu, "Export");
  assert.equal(UI_TRANSLATIONS.lv.exportMenu, "Eksportēt");
});

test("форматирует динамические UI и серверные сообщения", () => {
  assert.equal(uiText("en", "repeat", { seconds: 5 }), "Retry in 5 sec.");
  assert.match(serverMessage("lv", "TOO_MANY_REQUESTS", { seconds: 12 }), /12 sek/);
});
