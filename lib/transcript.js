const DEFAULT_MAX_CHARACTERS = 60_000;
const FIRST_GAP_MARKER = "\n\n[...пропущена часть между началом и серединой...]\n\n";
const SECOND_GAP_MARKER = "\n\n[...пропущена часть между серединой и концом...]\n\n";

export function normalizeTranscript(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Для очень длинного видео сохраняет начало, середину и конец, чтобы анализ не
 * основывался только на первых минутах.
 */
export function prepareTranscript(value, maxCharacters = DEFAULT_MAX_CHARACTERS) {
  const normalized = normalizeTranscript(value);
  const originalCharacters = normalized.length;

  if (originalCharacters <= maxCharacters) {
    return {
      text: normalized,
      originalCharacters,
      sentCharacters: originalCharacters,
      shortened: false,
    };
  }

  const markerCharacters = FIRST_GAP_MARKER.length + SECOND_GAP_MARKER.length;
  const chunkLength = Math.floor((maxCharacters - markerCharacters) / 3);
  const middleStart = Math.max(0, Math.floor((originalCharacters - chunkLength) / 2));

  const text = [
    normalized.slice(0, chunkLength),
    FIRST_GAP_MARKER,
    normalized.slice(middleStart, middleStart + chunkLength),
    SECOND_GAP_MARKER,
    normalized.slice(-chunkLength),
  ].join("");

  return {
    text: text.slice(0, maxCharacters),
    originalCharacters,
    sentCharacters: Math.min(text.length, maxCharacters),
    shortened: true,
  };
}

export function transcriptFromApifyItem(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  if (typeof item.transcript_only_text === "string") {
    return normalizeTranscript(item.transcript_only_text);
  }

  if (Array.isArray(item.transcript)) {
    return normalizeTranscript(
      item.transcript
        .map((segment) => (typeof segment === "string" ? segment : segment?.text))
        .filter(Boolean)
        .join(" "),
    );
  }

  return "";
}
