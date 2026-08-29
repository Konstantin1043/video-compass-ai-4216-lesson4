import { createRequire } from "node:module";
import PDFDocument from "pdfkit";
import { ANALYSIS_HEADINGS } from "./analysis-sections.js";

const require = createRequire(import.meta.url);

function fontPaths() {
  return {
    regular: require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf"),
    bold: require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf"),
  };
}

function safeText(value) {
  return String(value || "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
}

function list(doc, items, render) {
  for (const [index, item] of items.entries()) {
    doc.font("Regular").fontSize(10).fillColor("#26364a");
    doc.text(`${index + 1}. ${safeText(render(item))}`, { indent: 8, paragraphGap: 5 });
  }
}

function addFooter(doc, label) {
  const previousBottomMargin = doc.page.margins.bottom;
  const previousX = doc.x;
  const previousY = doc.y;
  const footerLineY = doc.page.height - 43;
  const footerTextY = doc.page.height - 31;

  doc.save();
  doc.moveTo(54, footerLineY).lineTo(doc.page.width - 54, footerLineY).lineWidth(0.5).strokeColor("#d9e3ed").stroke();
  doc.page.margins.bottom = 0;
  doc.font("Regular").fontSize(8).fillColor("#7b8da1");
  doc.text(label, 54, footerTextY, {
    width: doc.page.width - 108,
    align: "right",
    lineBreak: false,
  });
  doc.page.margins.bottom = previousBottomMargin;
  doc.x = previousX;
  doc.y = previousY;
  doc.restore();
}

export async function createAnalysisPdf(result) {
  const language = result.language || "ru";
  const fonts = fontPaths();
  const analysis = result.analysis;
  const headings = ANALYSIS_HEADINGS[language] || ANALYSIS_HEADINGS.ru;
  const doc = new PDFDocument({
    size: "A4",
    margin: 54,
    bufferPages: true,
    info: {
      Title: safeText(result.video?.title || "VideoCompass AI"),
      Author: "VideoCompass AI",
      Subject: "YouTube video analysis",
    },
  });
  doc.registerFont("Regular", fonts.regular);
  doc.registerFont("Bold", fonts.bold);
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const completed = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.font("Bold").fontSize(10).fillColor("#1769e0").text("VIDEOCOMPASS AI", { characterSpacing: 1.4 });
  doc.moveDown(0.7);
  doc.font("Bold").fontSize(22).fillColor("#10233d").text(safeText(result.video?.title || "YouTube video analysis"));
  if (result.video?.author) {
    doc.moveDown(0.25).font("Regular").fontSize(10).fillColor("#62758a").text(safeText(result.video.author));
  }
  if (result.video?.canonicalUrl) {
    doc.moveDown(0.25).fillColor("#1769e0").text(result.video.canonicalUrl, { link: result.video.canonicalUrl, underline: true });
  }
  doc.moveDown(1.2);

  const sections = [
    { body: () => doc.font("Regular").fontSize(10.5).fillColor("#26364a").text(safeText(analysis.about), { lineGap: 3 }) },
    { body: () => list(doc, analysis.summary, (item) => `${item.timestamp ? `[${item.timestamp}] ` : ""}${item.text}`) },
    { body: () => list(doc, analysis.keyIdeas, (item) => item) },
    { body: () => doc.font("Regular").fontSize(10.5).fillColor("#26364a").text(safeText(analysis.audience), { lineGap: 3 }) },
    { body: () => {
      doc.font("Bold").fontSize(18).fillColor("#1769e0").text(`${analysis.score}/100`);
      doc.moveDown(0.15).font("Regular").fontSize(10.5).fillColor("#26364a").text(safeText(analysis.scoreExplanation), { lineGap: 3 });
    } },
    { body: () => list(doc, analysis.actions, (item) => item) },
    { body: () => list(doc, analysis.doubts, (item) => item) },
    { body: () => list(doc, analysis.selfCheck, (item) => item) },
  ];

  sections.forEach((section, index) => {
    if (doc.y > 700) doc.addPage();
    doc.font("Bold").fontSize(12).fillColor("#10233d").text(`${String(index + 1).padStart(2, "0")}  ${safeText(headings[index])}`);
    doc.moveDown(0.45);
    section.body();
    doc.moveDown(1);
  });

  const pageCount = doc.bufferedPageRange().count;
  for (let page = 0; page < pageCount; page += 1) {
    doc.switchToPage(page);
    addFooter(doc, `VideoCompass AI  |  ${page + 1}/${pageCount}`);
  }

  doc.end();
  return completed;
}
