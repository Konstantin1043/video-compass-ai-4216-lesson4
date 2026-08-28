import assert from "node:assert/strict";
import test from "node:test";
import { ANALYSIS_HEADINGS } from "../lib/analysis-sections.js";
import {
  normalizeStructuredAnalysis,
  structuredAnalysisToMarkdown,
  structuredAnalysisToText,
} from "../lib/structured-analysis.js";

function fixture() {
  return {
    about: "Короткое описание.",
    summary: [0, 10, 20, 30, 40].map((seconds) => ({
      timestamp: `00:${String(seconds).padStart(2, "0")}`,
      text: `Пункт ${seconds}`,
    })),
    keyIdeas: ["Идея 1", "Идея 2"],
    audience: "Новичкам.",
    score: 82,
    scoreExplanation: "Практичный материал.",
    actions: ["Шаг 1", "Шаг 2", "Шаг 3"],
    doubts: ["Не все утверждения подтверждены."],
    selfCheck: ["Вопрос 1?", "Вопрос 2?", "Вопрос 3?"],
    chapters: [0, 10, 20, 30, 40].map((seconds) => ({
      timestamp: `00:${String(seconds).padStart(2, "0")}`,
      title: `Глава ${seconds}`,
    })),
  };
}

test("структурированный результат принимает 5–7 резюме и 5–12 настоящих глав", () => {
  const analysis = normalizeStructuredAnalysis(fixture(), [0, 10, 20, 30, 40], true);
  assert.equal(analysis.summary.length, 5);
  assert.equal(analysis.chapters.length, 5);
  assert.equal(analysis.score, 82);
});

test("структурированный результат отклоняет меньше пяти проверенных глав", () => {
  const value = fixture();
  value.chapters = value.chapters.slice(0, 4);
  assert.throws(
    () => normalizeStructuredAnalysis(value, [0, 10, 20, 30], true),
    /incomplete/i,
  );
});

test("резервный режим без сегментов допускает анализ без глав", () => {
  const value = fixture();
  value.chapters = [];
  const analysis = normalizeStructuredAnalysis(value, [], false);
  assert.equal(analysis.chapters.length, 0);
  assert.ok(analysis.summary.every((item) => item.timestamp === ""));
});

test("текстовый и Markdown-экспорт содержат восемь разделов", () => {
  const analysis = normalizeStructuredAnalysis(fixture(), [0, 10, 20, 30, 40], true);
  const plain = structuredAnalysisToText(analysis, "ru");
  const markdown = structuredAnalysisToMarkdown(analysis, "ru", {
    title: "Учебное видео",
    canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });
  ANALYSIS_HEADINGS.ru.forEach((heading, index) => {
    assert.match(plain, new RegExp(`^${index + 1}\\. ${heading}$`, "m"));
  });
  assert.equal((markdown.match(/^## \d+\. /gm) || []).length, 8);
  assert.match(markdown, /`00:10`/);
});
