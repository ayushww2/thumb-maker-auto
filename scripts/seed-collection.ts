import { loadSeedFile, upsertCollection } from "../src/lib/collection";

async function main() {
  const payload = await loadSeedFile();
  const result = await upsertCollection(payload);
  console.log(JSON.stringify({ ok: true, sourceCount: payload.videoCount, ...result }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
