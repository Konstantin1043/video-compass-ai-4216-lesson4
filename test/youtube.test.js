import assert from "node:assert/strict";
import test from "node:test";
import { parseYouTubeUrl } from "../lib/youtube.js";

const videoId = "dQw4w9WgXcQ";

for (const url of [
  `https://www.youtube.com/watch?v=${videoId}`,
  `https://youtu.be/${videoId}?si=example`,
  `https://youtube.com/shorts/${videoId}`,
  `https://m.youtube.com/live/${videoId}`,
  `https://www.youtube.com/embed/${videoId}`,
]) {
  test(`распознаёт ссылку: ${url}`, () => {
    assert.deepEqual(parseYouTubeUrl(url), {
      videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
  });
}

for (const invalid of [
  "",
  "youtube.com/watch?v=dQw4w9WgXcQ",
  "https://example.com/watch?v=dQw4w9WgXcQ",
  "https://www.youtube.com/playlist?list=PL123",
  "https://www.youtube.com/watch?v=too-short",
  "javascript:alert(1)",
]) {
  test(`отклоняет неподдерживаемую ссылку: ${invalid || "пустая строка"}`, () => {
    assert.equal(parseYouTubeUrl(invalid), null);
  });
}
