import { ANALYSIS_HEADINGS } from "./lib/analysis-sections.js";
import { youtubeTimestampUrl, parseTimecode } from "./lib/timecodes.js";

const token = new URL(location.href).searchParams.get("token") || location.pathname.split("/").filter(Boolean).pop() || "";
const loading = document.querySelector("#sharedLoading");
const error = document.querySelector("#sharedError");
const resultNode = document.querySelector("#sharedResult");

function showError(message) {
  loading.hidden = true;
  error.querySelector("p").textContent = message;
  error.hidden = false;
}

function appendList(container, items, videoId, timed = false) {
  const list = document.createElement("ul");
  items.forEach((item) => {
    const row = document.createElement("li");
    if (timed && item.timestamp) {
      const seconds = parseTimecode(item.timestamp);
      const href = youtubeTimestampUrl(videoId, seconds);
      if (href) {
        const link = document.createElement("a");
        link.className = "analysis-timecode"; link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer";
        link.textContent = `▶ ${item.timestamp}`; row.append(link, document.createTextNode(` ${item.text}`));
      } else row.textContent = item.text;
    } else row.textContent = typeof item === "string" ? item : item.text;
    list.append(row);
  });
  container.append(list);
}

function render(payload) {
  const result = payload.result;
  const analysis = result.analysis;
  const language = result.language || "en";
  document.documentElement.lang = language;
  document.title = `${result.video.title || "VideoCompass AI"} — VideoCompass AI`;
  document.querySelector("#sharedTitle").textContent = language === "ru" ? "Публичный разбор" : language === "lv" ? "Publiska analīze" : "Shared analysis";
  document.querySelector("#sharedThumbnail").src = result.video.thumbnailUrl;
  document.querySelector("#sharedThumbnail").alt = result.video.title || "YouTube";
  document.querySelector("#sharedVideoTitle").textContent = result.video.title || "YouTube";
  document.querySelector("#sharedAuthor").textContent = result.video.author || "";
  document.querySelector("#sharedScore").textContent = `${analysis.score}/100`;
  document.querySelector("#sharedAbout").textContent = analysis.about;
  document.querySelector("#sharedVideoLink").href = result.video.canonicalUrl;
  const analysisNode = document.querySelector("#sharedAnalysis");
  const headings = ANALYSIS_HEADINGS[language];
  const sectionBodies = [
    (body) => { const p = document.createElement("p"); p.textContent = analysis.about; body.append(p); },
    (body) => appendList(body, analysis.summary, result.video.videoId, true),
    (body) => appendList(body, analysis.keyIdeas, result.video.videoId),
    (body) => { const p = document.createElement("p"); p.textContent = analysis.audience; body.append(p); },
    (body) => { const p = document.createElement("p"); p.textContent = `${analysis.score}/100. ${analysis.scoreExplanation}`; body.append(p); },
    (body) => appendList(body, analysis.actions, result.video.videoId),
    (body) => appendList(body, analysis.doubts, result.video.videoId),
    (body) => appendList(body, analysis.selfCheck, result.video.videoId),
  ];
  headings.forEach((heading, index) => {
    const card = document.createElement("details"); card.className = "analysis-section is-visible"; card.open = index === 1;
    const summary = document.createElement("summary"); summary.className = "analysis-section-header";
    const number = document.createElement("span"); number.className = "analysis-section-number"; number.textContent = String(index + 1).padStart(2, "0");
    const title = document.createElement("span"); title.className = "analysis-section-title"; title.textContent = heading;
    const arrow = document.createElement("span"); arrow.className = "analysis-section-chevron"; arrow.textContent = "⌄"; arrow.setAttribute("aria-hidden", "true");
    const body = document.createElement("div"); body.className = "analysis-section-body"; sectionBodies[index](body);
    summary.append(number, title, arrow); card.append(summary, body); analysisNode.append(card);
  });
  document.querySelector("#sharedExpiry").textContent = `${language === "ru" ? "Ссылка действует до" : language === "lv" ? "Saite derīga līdz" : "Link expires"}: ${new Intl.DateTimeFormat(language, { dateStyle: "long" }).format(new Date(payload.expiresAt))}`;
  loading.hidden = true; resultNode.hidden = false;
}

fetch(`/api/share?token=${encodeURIComponent(token)}`)
  .then(async (response) => {
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || "Shared analysis is unavailable.");
    return payload;
  })
  .then(render)
  .catch((reason) => showError(reason.message));

