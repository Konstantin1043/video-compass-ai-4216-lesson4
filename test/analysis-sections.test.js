import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYSIS_HEADINGS,
  parseAnalysisSections,
} from "../lib/analysis-sections.js";

function analysisText(language, headingTemplate = (number, heading) => `${number}. ${heading}`) {
  return ANALYSIS_HEADINGS[language]
    .map(
      (heading, index) =>
        `${headingTemplate(index + 1, heading)}\nСодержимое раздела ${index + 1}.`,
    )
    .join("\n\n");
}

test("разбивает русский AI-ответ на восемь разделов", () => {
  const sections = parseAnalysisSections(analysisText("ru"), "ru");

  assert.equal(sections.length, 8);
  assert.deepEqual(
    sections.map((section) => section.number),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(sections[0].heading, "О ЧЁМ ВИДЕО");
  assert.match(sections[7].body, /раздела 8/i);
});

test("распознаёт английские заголовки с Markdown-оформлением", () => {
  const source = analysisText(
    "en",
    (number, heading) => `## **${number}. ${heading}:**`,
  );
  const sections = parseAnalysisSections(source, "en");

  assert.equal(sections.length, 8);
  assert.equal(sections[1].heading, "BRIEF SUMMARY");
});

test("сохраняет потенциальную HTML-разметку только как текст", () => {
  const source = analysisText("lv").replace(
    "Содержимое раздела 1.",
    '<img src=x onerror="alert(1)">',
  );
  const sections = parseAnalysisSections(source, "lv");

  assert.equal(sections.length, 8);
  assert.equal(sections[0].body, '<img src=x onerror="alert(1)">');
});

test("возвращает пустой результат для неполного формата", () => {
  const incomplete = "1. О ЧЁМ ВИДЕО\nТолько один раздел.";
  assert.deepEqual(parseAnalysisSections(incomplete, "ru"), []);
});
