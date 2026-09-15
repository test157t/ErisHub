import { getBackgroundAssets } from "./assets";

export type BackgroundAsset = { name: string; url: string; previewUrl?: string; type: "image" | "video" };

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function listCachedBackgroundAssets(): Promise<BackgroundAsset[]> {
  return getBackgroundAssets(false);
}

export async function resolveBackgroundAsset(value: string) {
  const query = value.trim();
  if (!query || query.toLowerCase() === "none" || query.toLowerCase() === "clear") return { name: "None", url: "", type: "image" as const };
  if (query.startsWith("/assets/chat-backgrounds/")) return { name: decodeURIComponent(query.split("/").pop() || query), url: query, type: query.includes("/videos/") ? "video" as const : "image" as const };

  const assets = await listCachedBackgroundAssets();
  const normalizedQuery = normalizeSearchText(query);
  const exact = assets.find((asset) => asset.name.toLowerCase() === query.toLowerCase() || normalizeSearchText(asset.name) === normalizedQuery);
  if (exact) return exact;
  const partial = assets.find((asset) => normalizeSearchText(asset.name).includes(normalizedQuery));
  if (partial) return partial;
  throw new Error(`No background asset matched "${query}".`);
}
