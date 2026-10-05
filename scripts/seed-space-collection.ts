import { readFile } from "fs/promises";
import path from "path";
import { upsertCollection, type SeedPayload } from "../src/lib/collection";
import { isExcludedSpaceYoutubeId } from "../src/lib/spaceExclusions";

async function main() {
  const file = path.join(process.cwd(), "data", "space-collection.json");
  const raw = await readFile(file, "utf8");
  const payload = JSON.parse(raw) as SeedPayload & { niche?: string };
  payload.niche = payload.niche || "space";
  payload.videos = payload.videos.filter(
    (v) => !isExcludedSpaceYoutubeId(v.youtubeId || v.videoId || ""),
  );
  for (const v of payload.videos) {
    v.niche = "space";
  }
  payload.videoCount = payload.videos.length;
  const result = await upsertCollection(payload);
  console.log(
    JSON.stringify(
      {
        ok: true,
        niche: "space",
        sourceCount: payload.videoCount,
        ...result,
        minViews: payload.minViews ?? result.minViews,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
