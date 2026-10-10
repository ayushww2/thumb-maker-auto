import "dotenv/config";
import { buildCrownPlaybook } from "../src/lib/crownWatchThumbAgent";

async function main() {
  const playbook = await buildCrownPlaybook(true);
  console.log(
    JSON.stringify(
      {
        ok: true,
        sampleSize: playbook.sampleSize,
        scanCount: playbook.scanCount,
        summary: playbook.summary,
        ctrTexts: playbook.ctrTexts,
        formats: playbook.thumbnailFormats,
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
