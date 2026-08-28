import { ANALYSIS_HEADINGS } from "./analysis-sections.js";
import { normalizeLanguage } from "./language.js";
import { formatTimecode, parseTimecode } from "./timecodes.js";

export const STRUCTURED_ANALYSIS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "about",
    "summary",
    "keyIdeas",
    "audience",
    "score",
    "scoreExplanation",
    "actions",
    "doubts",
    "selfCheck",
    "chapters",
  ],
  properties: {
    about: { type: "string" },
    summary: {
      type: "array",
      minItems: 5,
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["timestamp", "text"],
        properties: {
          timestamp: { type: "string" },
          text: { type: "string" },
        },
      },
    },
    keyIdeas: { type: "array", items: { type: "string" } },
    audience: { type: "string" },
    score: { type: "integer", minimum: 0, maximum: 100 },
    scoreExplanation: { type: "string" },
    actions: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
    doubts: { type: "array", items: { type: "string" } },
    selfCheck: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
    chapters: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["timestamp", "title"],
        properties: {
          timestamp: { type: "string" },
          title: { type: "string" },
        },
      },
    },
  },
});

function cleanText(value, max = 3_000) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanList(value, { min = 0, max = 12 } = {}) {
  const list = Array.isArray(value)
    ? value.map((item) => cleanText(item)).filter(Boolean).slice(0, max)
    : [];
  return list.length >= min ? list : list;
}

function validTimestamp(value, allowed) {
  const seconds = parseTimecode(value);
  return seconds !== null && allowed.has(seconds) ? formatTimecode(seconds) : "";
}

export function normalizeStructuredAnalysis(raw, allowedSeconds = [], hasTimecodes = false) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("Structured analysis must be an object");
  }

  const allowed = new Set(
    [...allowedSeconds].filter((seconds) => Number.isInteger(seconds) && seconds >= 0),
  );
  const summary = (Array.isArray(raw.summary) ? raw.summary : [])
    .map((item) => ({
      timestamp: hasTimecodes ? validTimestamp(item?.timestamp, allowed) : "",
      text: cleanText(item?.text),
    }))
    .filter((item) => item.text)
    .slice(0, 7);

  const chapters = (Array.isArray(raw.chapters) ? raw.chapters : [])
    .map((item) => ({
      timestamp: hasTimecodes ? validTimestamp(item?.timestamp, allowed) : "",
      title: cleanText(item?.title, 240),
    }))
    .filter((item) => item.title && item.timestamp)
    .slice(0, 12);

  const score = Math.max(0, Math.min(100, Math.round(Number(raw.score) || 0)));
  const result = {
    about: cleanText(raw.about),
    summary,
    keyIdeas: cleanList(raw.keyIdeas, { max: 12 }),
    audience: cleanText(raw.audience),
    score,
    scoreExplanation: cleanText(raw.scoreExplanation),
    actions: cleanList(raw.actions, { max: 5 }),
    doubts: cleanList(raw.doubts, { max: 10 }),
    selfCheck: cleanList(raw.selfCheck, { max: 3 }),
    chapters,
  };

  if (
    !result.about ||
    result.summary.length < 5 ||
    !result.audience ||
    !result.scoreExplanation ||
    result.actions.length < 3 ||
    result.selfCheck.length !== 3 ||
    (hasTimecodes && result.chapters.length < 5)
  ) {
    throw new TypeError("Structured analysis is incomplete");
  }

  return result;
}

function bulletList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

export function structuredAnalysisToText(analysis, language = "ru") {
  const selectedLanguage = normalizeLanguage(language) || "ru";
  const headings = ANALYSIS_HEADINGS[selectedLanguage];
  const summary = analysis.summary.map((item) =>
    `- ${item.timestamp ? `[${item.timestamp}] ` : ""}${item.text}`,
  );
  const score = `${analysis.score}/100. ${analysis.scoreExplanation}`;
  const bodies = [
    analysis.about,
    summary.join("\n"),
    bulletList(analysis.keyIdeas),
    analysis.audience,
    score,
    bulletList(analysis.actions),
    bulletList(analysis.doubts),
    analysis.selfCheck.map((item, index) => `${index + 1}. ${item}`).join("\n"),
  ];

  return headings
    .map((heading, index) => `${index + 1}. ${heading}\n${bodies[index]}`)
    .join("\n\n")
    .trim();
}

export function structuredAnalysisToMarkdown(analysis, language = "ru", video = null) {
  const selectedLanguage = normalizeLanguage(language) || "ru";
  const headings = ANALYSIS_HEADINGS[selectedLanguage];
  const source = video?.canonicalUrl ? `\n\n[YouTube](${video.canonicalUrl})` : "";
  const summary = analysis.summary.map((item) =>
    `- ${item.timestamp ? `\`${item.timestamp}\` ` : ""}${item.text}`,
  );
  const bodies = [
    analysis.about,
    summary.join("\n"),
    bulletList(analysis.keyIdeas),
    analysis.audience,
    `**${analysis.score}/100.** ${analysis.scoreExplanation}`,
    bulletList(analysis.actions),
    bulletList(analysis.doubts),
    analysis.selfCheck.map((item, index) => `${index + 1}. ${item}`).join("\n"),
  ];
  return `${video?.title ? `# ${video.title}` : "# VideoCompass AI"}${source}\n\n${headings
    .map((heading, index) => `## ${index + 1}. ${heading}\n\n${bodies[index]}`)
    .join("\n\n")}`;
}
