import { ANALYSIS_HEADINGS } from "./analysis-sections.js";
import { normalizeLanguage } from "./language.js";

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

function normalizedHeading(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/^#{1,6}\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/[.:]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function headingNumber(line, language) {
  const match = normalizedHeading(line).match(/^(\d+)[.)]\s+(.+)$/);
  if (!match) return null;

  const number = Number(match[1]);
  const expected = ANALYSIS_HEADINGS[language][number - 1];
  return expected && normalizedHeading(match[2]) === normalizedHeading(expected)
    ? number
    : null;
}

/**
 * Keeps timestamp markers only in section 2 and only when the timestamp was
 * present in the transcript sent to Gemini. Suspicious bracketed time values
 * are removed instead of being exposed as clickable links.
 */
export function sanitizeAnalysisTimecodes(
  analysis,
  allowedSeconds = [],
  language = "ru",
) {
  const allowed = new Set(
    [...allowedSeconds].filter((value) => Number.isInteger(value) && value >= 0),
  );
  const selectedLanguage = normalizeLanguage(language) || "ru";
  let sectionNumber = 0;
  let summaryPoints = 0;

  return String(analysis || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const detectedHeading = headingNumber(line, selectedLanguage);
      if (detectedHeading !== null) {
        sectionNumber = detectedHeading;
        return line;
      }

      const listItem = line.match(/^(\s*(?:[-*•]|\d+[.)])\s+)(.*)$/);
      if (sectionNumber === 2 && allowed.size > 0 && listItem) {
        const marker = listItem[2].match(/^\[([^\]\r\n]{1,16})\]\s*(.*)$/);
        const seconds = marker ? parseTimecode(marker[1]) : null;
        if (seconds === null || !allowed.has(seconds) || summaryPoints >= 7) {
          return null;
        }

        summaryPoints += 1;
        const remainder = marker[2] ? ` ${marker[2]}` : "";
        return `${listItem[1]}[${formatTimecode(seconds)}]${remainder}`;
      }

      return line.replace(BRACKET_MARKER_PATTERN, (match, candidate) => {
        if (!looksLikeTimecode(candidate)) {
          return match;
        }
        return "";
      });
    })
    .filter((line) => line !== null)
    .join("\n")
    .replace(/(^|\n)(\s*[-*\u2022]|\s*\d+[.)])\s{2,}/g, "$1$2 ")
    .trim();
}
