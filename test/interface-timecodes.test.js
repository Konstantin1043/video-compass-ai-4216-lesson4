import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("кликабельный тайм-код безопасен и доступен с клавиатуры", async () => {
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(script, /link\.target = "_blank"/);
  assert.match(script, /link\.rel = "noopener noreferrer"/);
  assert.match(script, /link\.setAttribute\("aria-label"/);
  assert.match(styles, /\.analysis-timecode:focus-visible/);
});
