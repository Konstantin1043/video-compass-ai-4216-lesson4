import { formatTimecode, parseTimecode } from "./timecodes.js";

const DEFAULT_MAX_CHARACTERS = 60_000;
const FIRST_GAP_MARKER = "\n\n[...пропущена часть между началом и серединой...]\n\n";
const SECOND_GAP_MARKER = "\n\n[...пропущена часть между серединой и концом...]\n\n";
const TIMED_GAP_MARKER = "\n\n[... transcript gap ...]\n\n";

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
  return transcriptDataFromApifyItem(item).text;
}

function segmentTiming(segment) {
  if (segment?.startMs !== undefined && segment?.startMs !== null && segment.startMs !== "") {
    const startMs = Number(segment.startMs);
    if (Number.isFinite(startMs) && startMs >= 0) {
      return {
        startMs: Math.floor(startMs),
        startSeconds: Math.floor(startMs / 1_000),
      };
    }
  }

  const startSeconds = parseTimecode(segment?.startTimeText);
  return startSeconds === null
    ? null
    : { startMs: startSeconds * 1_000, startSeconds };
}

export function transcriptDataFromApifyItem(item) {
  if (!item || typeof item !== "object") {
    return { text: "", segments: [] };
  }

  const segments = Array.isArray(item.transcript)
    ? item.transcript
        .map((segment) => {
          if (!segment || typeof segment !== "object") return null;

          const text = normalizeTranscript(segment.text);
          const timing = segmentTiming(segment);
          if (!text || !timing) return null;

          const hasEndMs =
            segment.endMs !== undefined && segment.endMs !== null && segment.endMs !== "";
          const endMs = hasEndMs ? Number(segment.endMs) : Number.NaN;
          return {
            text,
            startMs: timing.startMs,
            endMs: Number.isFinite(endMs) && endMs >= 0 ? Math.floor(endMs) : null,
            startSeconds: timing.startSeconds,
            startTimeText: formatTimecode(timing.startSeconds),
          };
        })
        .filter(Boolean)
    : [];

  const completeText =
    typeof item.transcript_only_text === "string"
      ? normalizeTranscript(item.transcript_only_text)
      : "";
  const textFromSegments = normalizeTranscript(
    (Array.isArray(item.transcript) ? item.transcript : [])
      .map((segment) => (typeof segment === "string" ? segment : segment?.text))
      .filter(Boolean)
      .join(" "),
  );
  const plainText = completeText || textFromSegments;

  return { text: plainText, segments };
}

function timedLine(segment) {
  return `[${formatTimecode(segment.startSeconds)}] ${segment.text}`;
}

function takeForward(lines, startIndex, budget) {
  const indexes = [];
  let used = 0;

  for (let index = startIndex; index < lines.length; index += 1) {
    const cost = lines[index].length + (indexes.length ? 1 : 0);
    if (used + cost > budget) break;
    indexes.push(index);
    used += cost;
  }

  return indexes;
}

function takeBackward(lines, budget) {
  const indexes = [];
  let used = 0;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const cost = lines[index].length + (indexes.length ? 1 : 0);
    if (used + cost > budget) break;
    indexes.push(index);
    used += cost;
  }

  return indexes.reverse();
}

/**
 * Adds source timestamps to the prompt and shortens long transcripts only at
 * subtitle segment boundaries.
 */
export function prepareTranscriptData(value, maxCharacters = DEFAULT_MAX_CHARACTERS) {
  const data =
    typeof value === "string"
      ? { text: normalizeTranscript(value), segments: [] }
      : {
          text: normalizeTranscript(value?.text),
          segments: Array.isArray(value?.segments) ? value.segments : [],
        };

  if (!data.segments.length) {
    return {
      ...prepareTranscript(data.text, maxCharacters),
      hasTimecodes: false,
      allowedTimestampSeconds: [],
    };
  }

  const lines = data.segments.map(timedLine);
  const fullTimedText = lines.join("\n");
  const originalCharacters = data.text.length;

  if (fullTimedText.length <= maxCharacters) {
    return {
      text: fullTimedText,
      originalCharacters,
      sentCharacters: fullTimedText.length,
      shortened: false,
      hasTimecodes: true,
      allowedTimestampSeconds: data.segments.map((segment) => segment.startSeconds),
    };
  }

  const chunkBudget = Math.max(
    1,
    Math.floor((maxCharacters - TIMED_GAP_MARKER.length * 2) / 3),
  );
  const middleStart = Math.max(0, Math.floor(lines.length / 2) - 1);
  const selectedIndexes = [
    ...takeForward(lines, 0, chunkBudget),
    ...takeForward(lines, middleStart, chunkBudget),
    ...takeBackward(lines, chunkBudget),
  ];
  const uniqueIndexes = [...new Set(selectedIndexes)].sort((a, b) => a - b);
  const parts = [];

  uniqueIndexes.forEach((index, position) => {
    if (position > 0 && index !== uniqueIndexes[position - 1] + 1) {
      parts.push(TIMED_GAP_MARKER.trim());
    }
    parts.push(lines[index]);
  });

  const text = parts.join("\n");
  const usedSegments = uniqueIndexes.map((index) => data.segments[index]);

  return {
    text,
    originalCharacters,
    sentCharacters: text.length,
    shortened: true,
    hasTimecodes: usedSegments.length > 0,
    allowedTimestampSeconds: usedSegments.map((segment) => segment.startSeconds),
  };
}
