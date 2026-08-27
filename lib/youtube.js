const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);

function cleanVideoId(value) {
  const candidate = String(value || "").trim();
  return VIDEO_ID_PATTERN.test(candidate) ? candidate : null;
}

/**
 * Разбирает поддерживаемые ссылки YouTube и возвращает безопасную каноническую
 * ссылку. Плейлисты без конкретного video ID намеренно не поддерживаются.
 */
export function parseYouTubeUrl(input) {
  const raw = String(input || "").trim();

  if (!raw || raw.length > 500) {
    return null;
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  let videoId = null;

  if (hostname === "youtu.be") {
    videoId = cleanVideoId(url.pathname.split("/").filter(Boolean)[0]);
  } else if (YOUTUBE_HOSTS.has(hostname)) {
    if (url.pathname === "/watch") {
      videoId = cleanVideoId(url.searchParams.get("v"));
    } else {
      const [kind, id] = url.pathname.split("/").filter(Boolean);
      if (["shorts", "live", "embed"].includes(kind)) {
        videoId = cleanVideoId(id);
      }
    }
  }

  if (!videoId) {
    return null;
  }

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}
