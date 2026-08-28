import { fetchWithTimeout } from "./service-error.js";

export async function fetchYouTubeMetadata(fetchImpl, canonicalUrl, videoId) {
  const fallback = {
    title: "",
    author: "",
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };

  try {
    const endpoint = new URL("https://www.youtube.com/oembed");
    endpoint.searchParams.set("url", canonicalUrl);
    endpoint.searchParams.set("format", "json");
    const response = await fetchWithTimeout(fetchImpl, endpoint, { method: "GET" }, 8_000);
    if (!response.ok) return fallback;
    const payload = await response.json();
    return {
      title: typeof payload?.title === "string" ? payload.title.trim().slice(0, 300) : "",
      author:
        typeof payload?.author_name === "string"
          ? payload.author_name.trim().slice(0, 200)
          : "",
      thumbnailUrl:
        typeof payload?.thumbnail_url === "string" && payload.thumbnail_url.startsWith("https://")
          ? payload.thumbnail_url
          : fallback.thumbnailUrl,
    };
  } catch {
    return fallback;
  }
}

