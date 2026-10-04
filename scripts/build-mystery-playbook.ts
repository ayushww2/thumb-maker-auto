import { buildMysteryPlaybook } from "../src/lib/mysteryThumbAgent";

async function main() {
  const playbook = await buildMysteryPlaybook(true);
  console.log(
    JSON.stringify(
      {
        ok: true,
        generatedAt: playbook.generatedAt,
        sampleSize: playbook.sampleSize,
        viralCount: playbook.viralCount,
        lowCount: playbook.lowCount,
        summary: playbook.summary,
        viralPatterns: playbook.viralPatterns.slice(0, 5),
        thumbnailFormats: playbook.thumbnailFormats.slice(0, 5),
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
