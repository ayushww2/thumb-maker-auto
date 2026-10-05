/**
 * Space comps that must never be used as format references / training pool.
 * Usually mystery/news packages that leaked into the Space niche.
 */
export const SPACE_EXCLUDED_YOUTUBE_IDS = new Set<string>([
  // Mystery/breaking-news "GOD? / BREAKING NEWS" package — not a Space layout
  "bVyJzqrQacI",
]);

export function isExcludedSpaceYoutubeId(youtubeId: string): boolean {
  return SPACE_EXCLUDED_YOUTUBE_IDS.has(youtubeId);
}
