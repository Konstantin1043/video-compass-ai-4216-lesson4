const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const BRACKET_MARKER_PATTERN = /\[([^\]\r\n]{1,16})\]/g;

export function parseTimecode(value) {
  const text = String(value || "").trim();
  if (!/^\d{1,4}:\d{2}(?::\d{2})?$/.test(text)) {
    return null;
  }

  const parts = text.split(":").map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return null;
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return seconds < 60 ? minutes * 60 + seconds : null;
  }

  const [hours, minutes, seconds] = parts;
  return minutes < 60 && seconds < 60
    ? hours * 3_600 + minutes * 60 + seconds
    : null;
}

export function formatTimecode(totalSeconds) {
  if (!Number.isInteger(totalSeconds) || totalSeconds < 0) {
    return null;
  }

  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function youtubeTimestampUrl(videoId, totalSeconds) {
  if (
    !VIDEO_ID_PATTERN.test(String(videoId || "")) ||
    !Number.isInteger(totalSeconds) ||
    totalSeconds < 0
  ) {
    return null;
  }

  return `https://www.youtube.com/watch?v=${videoId}&t=${totalSeconds}s`;
}

function looksLikeTimecode(value) {
  return /[:\d]/.test(value) && /:/.test(value);
}

/**
 * Keeps timestamp markers only in section 2 and only when the timestamp was
 * present in the transcript sent to Gemini. Suspicious bracketed time values
 * are removed instead of being exposed as clickable links.
 */
export function sanitizeAnalysisTimecodes(analysis, allowedSeconds = []) {
  const allowed = new Set(
    [...allowedSeconds].filter((value) => Number.isInteger(value) && value >= 0),
  );
  let sectionNumber = 0;

  return String(analysis || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const heading = line
        .trim()
        .replace(/^#{1,6}\s*/, "")
        .replace(/\*\*/g, "")
        .match(/^(\d+)[.)]\s+/);
      if (heading) {
        sectionNumber = Number(heading[1]);
      }

      return line.replace(BRACKET_MARKER_PATTERN, (match, candidate) => {
        if (!looksLikeTimecode(candidate)) {
          return match;
        }

        const seconds = parseTimecode(candidate);
        if (sectionNumber !== 2 || seconds === null || !allowed.has(seconds)) {
          return "";
        }

        return `[${formatTimecode(seconds)}]`;
      });
    })
    .join("\n")
    .replace(/(^|\n)(\s*[-*\u2022]|\s*\d+[.)])\s{2,}/g, "$1$2 ")
    .trim();
}
