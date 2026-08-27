import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTimecode,
  parseTimecode,
  sanitizeAnalysisTimecodes,
  youtubeTimestampUrl,
} from "../lib/timecodes.js";

test("преобразует 03:42 и 1:03:42 в секунды", () => {
  assert.equal(parseTimecode("03:42"), 222);
  assert.equal(parseTimecode("1:03:42"), 3_822);
  assert.equal(formatTimecode(222), "03:42");
  assert.equal(formatTimecode(3_822), "1:03:42");
});

test("отклоняет отрицательные и неправильные метки", () => {
  assert.equal(parseTimecode("-03:42"), null);
  assert.equal(parseTimecode("03:99"), null);
  assert.equal(parseTimecode("1:70:00"), null);
  assert.equal(parseTimecode("3:4"), null);
});

test("строит только безопасную YouTube-ссылку", () => {
  assert.equal(
    youtubeTimestampUrl("dQw4w9WgXcQ", 222),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=222s",
  );
  assert.equal(youtubeTimestampUrl("bad&id=attack", 222), null);
  assert.equal(youtubeTimestampUrl("dQw4w9WgXcQ", -1), null);
});

test("оставляет реальную метку только в кратком резюме", () => {
  const analysis = `1. О ЧЁМ ВИДЕО
[00:10] здесь метки быть не должно
**2. КРАТКОЕ РЕЗЮМЕ**
- [0:10] реальная метка
- [09:59] выдуманная метка
- [-00:10] отрицательная метка
- [00:99] повреждённая метка
3. КЛЮЧЕВЫЕ ИДЕИ И ФАКТЫ
- [00:10] в другом разделе`;
  const sanitized = sanitizeAnalysisTimecodes(analysis, [10]);

  assert.match(sanitized, /- \[00:10\] реальная/);
  assert.equal((sanitized.match(/\[00:10\]/g) || []).length, 1);
  assert.doesNotMatch(sanitized, /09:59|-00:10|00:99/);
});
