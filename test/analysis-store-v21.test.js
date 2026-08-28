import assert from "node:assert/strict";
import test from "node:test";
import { createAnalysisStore, publicHistoryJob, publicResult } from "../lib/analysis-store.js";

const result = {
  id: "result-1",
  status: "completed",
  video_id: "dQw4w9WgXcQ",
  canonical_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  language: "ru",
  video_title: "Видео",
  video_author: "Автор",
  analysis: { score: 91, about: "Описание", keyIdeas: ["Секрет"] },
  analysis_text: "Полный анализ",
  transcript_text: "Очень длинный транскрипт",
  transcript_segments: [{ startSeconds: 0, text: "Очень длинный транскрипт" }],
};

test("карточка истории не загружает полный транскрипт и полный анализ", () => {
  const item = publicHistoryJob({ id: "job-1", status: "completed", created_at: "2026-08-28T00:00:00Z" }, result);
  assert.equal(item.result.analysis.score, 91);
  assert.equal(item.result.analysis.about, "Описание");
  assert.equal(item.result.transcript, undefined);
  assert.equal(item.result.analysisText, undefined);
  assert.equal(item.result.analysis.keyIdeas, undefined);
});

test("публичное представление полного результата сохраняет транскрипт для владельца", () => {
  const payload = publicResult(result);
  assert.equal(payload.transcript.text, "Очень длинный транскрипт");
  assert.equal(payload.analysisText, "Полный анализ");
});

test("история безопасно формирует PostgREST in-фильтр для UUID", async () => {
  const paths = [];
  const store = createAnalysisStore({
    serviceRequest: async (path) => {
      paths.push(path);
      if (path.includes("favorite=eq.true")) {
        return [{ id: "job-1", result_id: "22222222-2222-4222-8222-222222222222", status: "completed", created_at: "2026-08-28T00:00:00Z" }];
      }
      if (path.includes("favorite=eq.false")) return [];
      return [{ ...result, id: "22222222-2222-4222-8222-222222222222" }];
    },
  });
  const items = await store.listHistory("11111111-1111-4111-8111-111111111111");
  assert.equal(items.length, 1);
  assert.match(paths[2], /id=in\.\(22222222-2222-4222-8222-222222222222\)/);
  assert.doesNotMatch(paths[2], /%22|%2C/);
});
