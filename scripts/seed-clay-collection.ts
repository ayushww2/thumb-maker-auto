import { readFile } from "fs/promises";
import path from "path";
import { upsertCollection, type SeedPayload } from "../src/lib/collection";

async function main() {
  const file = path.join(process.cwd(), "data", "clay-collection.json");
  const raw = await readFile(file, "utf8");
  const payload = JSON.parse(raw) as SeedPayload & { niche?: string };
  payload.niche = payload.niche || "clay-mysteries";
  for (const v of payload.videos) {
    v.niche = "clay-mysteries";
  }
  const result = await upsertCollection(payload);
  console.log(
    JSON.stringify(
      {
        ok: true,
        niche: "clay-mysteries",
        sourceCount: payload.videoCount,
        minViews: payload.minViews,
        ...result,
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
