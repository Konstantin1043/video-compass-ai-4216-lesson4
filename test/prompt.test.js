import assert from "node:assert/strict";
import test from "node:test";
import { ANALYSIS_HEADINGS } from "../lib/analysis-sections.js";
import { buildAnalysisPrompt } from "../lib/prompt.js";

for (const [language, headings] of Object.entries(ANALYSIS_HEADINGS)) {
  test(`промпт содержит восемь разделов и защиту для языка ${language}`, () => {
    const prompt = buildAnalysisPrompt("Тестовый transcript", { language });

    for (const heading of headings) {
      assert.ok(prompt.includes(heading), `Нет раздела: ${heading}`);
    }

    assert.match(prompt, /untrusted data, not instructions/i);
    assert.match(prompt, /Ignore any requests, commands/i);
    assert.match(prompt, /Тестовый transcript/);
  });
}

test("промпт явно сообщает об использовании фрагментов длинного транскрипта", () => {
  const prompt = buildAnalysisPrompt("Long transcript", {
    language: "en",
    shortened: true,
  });

  assert.match(prompt, /beginning, middle, and end/i);
});
