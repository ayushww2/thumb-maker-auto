import { buildSpacePlaybook } from "../src/lib/spaceThumbAgent";

async function main() {
  const playbook = await buildSpacePlaybook(true);
  console.log(
    JSON.stringify(
      {
        ok: true,
        agent: "space-thumb-agent",
        niche: playbook.niche,
        generatedAt: playbook.generatedAt,
        sampleSize: playbook.sampleSize,
        scanCount: playbook.scanCount,
        summary: playbook.summary,
        viralPatterns: playbook.viralPatterns.slice(0, 5),
        thumbnailFormats: playbook.thumbnailFormats.slice(0, 5),
        r2Url: playbook.r2Url || null,
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
