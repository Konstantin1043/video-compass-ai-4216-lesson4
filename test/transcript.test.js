import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareTranscript,
  prepareTranscriptData,
  transcriptDataFromApifyItem,
  transcriptFromApifyItem,
} from "../lib/transcript.js";

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

test("сохраняет startMs и startTimeText из сегментов Apify", () => {
  const result = transcriptDataFromApifyItem({
    transcript_only_text: "Первый второй",
    transcript: [
      { text: "Первый", startMs: "222345", endMs: "225678", startTimeText: "3:42" },
      { text: "Второй", startTimeText: "1:03:42" },
    ],
  });

  assert.equal(result.text, "Первый второй");
  assert.deepEqual(
    result.segments.map(({ text, startMs, endMs, startSeconds, startTimeText }) => ({
      text,
      startMs,
      endMs,
      startSeconds,
      startTimeText,
    })),
    [
      {
        text: "Первый",
        startMs: 222_345,
        endMs: 225_678,
        startSeconds: 222,
        startTimeText: "03:42",
      },
      {
        text: "Второй",
        startMs: 3_822_000,
        endMs: null,
        startSeconds: 3_822,
        startTimeText: "1:03:42",
      },
    ],
  );
});

test("без временных сегментов оставляет обычный текст", () => {
  const result = prepareTranscriptData(
    transcriptDataFromApifyItem({ transcript_only_text: "Обычный транскрипт." }),
  );

  assert.equal(result.text, "Обычный транскрипт.");
  assert.equal(result.hasTimecodes, false);
  assert.deepEqual(result.allowedTimestampSeconds, []);
});

test("длинный транскрипт сокращается целыми сегментами", () => {
  const segments = Array.from({ length: 30 }, (_, index) => ({
    text: `Целый сегмент ${index}`,
    startMs: String(index * 60_000),
    startTimeText: `${index}:00`,
  }));
  const data = transcriptDataFromApifyItem({ transcript: segments });
  const result = prepareTranscriptData(data, 300);

  assert.equal(result.shortened, true);
  assert.equal(result.hasTimecodes, true);
  assert.ok(result.text.length <= 300);
  assert.match(result.text, /^\[00:00\] Целый сегмент 0/);
  assert.match(result.text, /\[14:00\] Целый сегмент 14/);
  assert.match(result.text, /\[29:00\] Целый сегмент 29$/);
  assert.equal(result.text.includes("Целый сегмент 1\n"), true);
});
