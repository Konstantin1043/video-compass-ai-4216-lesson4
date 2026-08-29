import historyFunction from "../../lib/analysis-api/history.js";
import startAnalysisFunction from "../../lib/analysis-api/start.js";
import statusAnalysisFunction from "../../lib/analysis-api/status.js";
import stepAnalysisFunction from "../../lib/analysis-api/step.js";

const handlers = new Map([
  ["history", historyFunction],
  ["start", startAnalysisFunction],
  ["status", statusAnalysisFunction],
  ["step", stepAnalysisFunction],
]);

function requestedAction(request) {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  return segments.at(-1) || "";
}

export const maxDuration = 90;

export default {
  async fetch(request) {
    const handler = handlers.get(requestedAction(request));
    if (!handler) {
      return new Response(JSON.stringify({ ok: false, error: "NOT_FOUND" }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    return handler.fetch(request);
  },
};
