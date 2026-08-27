import { normalizeLanguage } from "./language.js";

export const ANALYSIS_HEADINGS = Object.freeze({
  ru: Object.freeze([
    "О ЧЁМ ВИДЕО",
    "КРАТКОЕ РЕЗЮМЕ",
    "КЛЮЧЕВЫЕ ИДЕИ И ФАКТЫ",
    "КОМУ БУДЕТ ПОЛЕЗНО",
    "СТОИТ ЛИ СМОТРЕТЬ",
    "ЧТО МОЖНО ПРИМЕНИТЬ",
    "ЧТО ВЫЗЫВАЕТ СОМНЕНИЯ",
    "ВОПРОСЫ ДЛЯ САМОПРОВЕРКИ",
  ]),
  en: Object.freeze([
    "WHAT THE VIDEO IS ABOUT",
    "BRIEF SUMMARY",
    "KEY IDEAS AND FACTS",
    "WHO WILL BENEFIT",
    "IS IT WORTH WATCHING",
    "PRACTICAL ACTIONS",
    "QUESTIONABLE CLAIMS",
    "SELF-CHECK QUESTIONS",
  ]),
  lv: Object.freeze([
    "PAR KO IR VIDEO",
    "ĪSS KOPSAVILKUMS",
    "GALVENĀS IDEJAS UN FAKTI",
    "KAM VIDEO BŪS NODERĪGS",
    "VAI IR VĒRTS SKATĪTIES",
    "PRAKTISKĀ RĪCĪBA",
    "APŠAUBĀMI APGALVOJUMI",
    "PAŠPĀRBAUDES JAUTĀJUMI",
  ]),
});

function normalizedHeading(value) {
  return value
    .normalize("NFKC")
    .replace(/^#{1,6}\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/[.:]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function trimEmptyEdges(lines) {
  let start = 0;
  let end = lines.length;

  while (start < end && !lines[start].trim()) {
    start += 1;
  }
  while (end > start && !lines[end - 1].trim()) {
    end -= 1;
  }

  return lines.slice(start, end);
}

export function parseAnalysisSections(analysis, language = "ru") {
  if (typeof analysis !== "string" || !analysis.trim()) {
    return [];
  }

  const selectedLanguage = normalizeLanguage(language) || "ru";
  const headings = ANALYSIS_HEADINGS[selectedLanguage];
  const sections = [];
  let currentSection = null;

  for (const rawLine of analysis.replace(/\r\n?/g, "\n").split("\n")) {
    const candidate = normalizedHeading(rawLine);
    const match = candidate.match(/^(\d+)[.)]\s+(.+)$/);

    if (match) {
      const number = Number(match[1]);
      const expectedHeading = headings[number - 1];
      if (expectedHeading && normalizedHeading(match[2]) === normalizedHeading(expectedHeading)) {
        currentSection = { number, heading: expectedHeading, lines: [] };
        sections.push(currentSection);
        continue;
      }
    }

    if (currentSection) {
      currentSection.lines.push(rawLine);
    }
  }

  if (sections.length !== headings.length) {
    return [];
  }

  return sections.map(({ number, heading, lines }) => ({
    number,
    heading,
    body: trimEmptyEdges(lines).join("\n"),
  }));
}
