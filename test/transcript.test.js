import assert from "node:assert/strict";
import test from "node:test";
import { prepareTranscript, transcriptFromApifyItem } from "../lib/transcript.js";

test("короткий транскрипт передаётся полностью", () => {
  const result = prepareTranscript("Первая строка.\n\nВторая строка.", 100);
  assert.equal(result.shortened, false);
  assert.equal(result.text, "Первая строка.\n\nВторая строка.");
  assert.equal(result.originalCharacters, result.sentCharacters);
});

test("длинный транскрипт сокращается до заданного размера", () => {
  const source = Array.from({ length: 2_000 }, (_, index) => `Фрагмент-${index}`).join(" ");
  const result = prepareTranscript(source, 900);

  assert.equal(result.shortened, true);
  assert.ok(result.text.length <= 900);
  assert.match(result.text, /Фрагмент-0/);
  assert.match(result.text, /пропущена часть/);
  assert.match(result.text, /Фрагмент-1999/);
});

test("читает полный текст из ответа Apify", () => {
  assert.equal(
    transcriptFromApifyItem({ transcript_only_text: " Один  текст. " }),
    "Один текст.",
  );
});

test("собирает текст из сегментов Apify", () => {
  assert.equal(
    transcriptFromApifyItem({ transcript: [{ text: "Один" }, { text: "два" }] }),
    "Один два",
  );
});
