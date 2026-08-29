import assert from "node:assert/strict";
import test from "node:test";
import { createAnalysisPdf } from "../lib/pdf-export.js";

function result(language) {
  return {
    language,
    video: {
      title: language === "ru" ? "Проверка русского PDF" : language === "lv" ? "Latviešu PDF pārbaude" : "English PDF check",
      author: "VideoCompass AI",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    },
    analysis: {
      about: "Описание результата / Result description / Rezultāta apraksts.",
      summary: [0, 10, 20, 30, 40].map((seconds) => ({ timestamp: `00:${String(seconds).padStart(2, "0")}`, text: `Пункт ${seconds}` })),
      keyIdeas: ["Идея"], audience: "Аудитория", score: 90,
      scoreExplanation: "Понятное объяснение.", actions: ["Шаг 1", "Шаг 2", "Шаг 3"],
      doubts: ["Ограничение"], selfCheck: ["Вопрос 1?", "Вопрос 2?", "Вопрос 3?"], chapters: [],
    },
  };
}

function countPages(buffer) {
  return (buffer.toString("latin1").match(/\/Type\s*\/Page(?!s)\b/g) || []).length;
}

for (const language of ["ru", "en", "lv"]) {
  test(`PDF ${language.toUpperCase()} создаётся с внедрённым шрифтом`, async () => {
    const buffer = await createAnalysisPdf(result(language));
    assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
    assert.ok(buffer.length > 3_000);
    assert.match(buffer.toString("latin1"), /DejaVuSans/i);
    assert.equal(countPages(buffer), 1);
  });
}

test("длинный PDF переносится на несколько страниц без лишней пары страниц", async () => {
  const fixture = result("ru");
  const paragraph = "Подробный фрагмент анализа с полезными выводами и практическими пояснениями. ".repeat(18);
  fixture.analysis.about = paragraph;
  fixture.analysis.keyIdeas = Array.from({ length: 16 }, (_, index) => `${index + 1}. ${paragraph}`);
  fixture.analysis.actions = Array.from({ length: 12 }, (_, index) => `Действие ${index + 1}: ${paragraph}`);
  const buffer = await createAnalysisPdf(fixture);
  const pages = countPages(buffer);
  assert.ok(pages > 1);
  assert.ok(pages < 20);
});
