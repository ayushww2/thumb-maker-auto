import { PrismaClient } from "@prisma/client";
import { readFile, writeFile } from "fs/promises";

const prisma = new PrismaClient();

const extraFormats = [
  "News-realism clickbait split: LEFT shocked TV news anchor close-up; RIGHT photoreal discovery scene; THICK red arrow + RED circle on the clue; bold blue banner with 3–6 word ALL-CAPS punch line; optional white ticker strip.",
  "Breaking-news package: red/white BREAKING badge, anchor reaction, evidence scene, saturated red callout arrow/circle, short banner text that adds a new claim not already in the face.",
];

const extraDos = [
  "For diver/sealed-door/discovery titles, DEFAULT to news-realism clickbait: anchor face + discovery scene + thick red arrow/circle + short banner text.",
  "Make clickbait graphics look REAL and thick (YouTube red arrow/circle), never thin decorative lines.",
  "Always put readable short ALL-CAPS text on a solid banner for mystery discovery packages.",
];

const extraDonts = [
  "Do not generate a clean cinematic poster with no text, no arrow, and no human reaction for discovery titles.",
  "Do not use faint yellow hairlines instead of thick red clickbait arrows.",
];

async function main() {
  const row = await prisma.agentPlaybook.findUnique({
    where: { id: "mystery-thumb-agent" },
  });
  if (!row) throw new Error("no playbook");

  const formats = Array.from(
    new Set([...(row.thumbnailFormats as string[]), ...extraFormats]),
  );
  const doList = Array.from(new Set([...(row.doList as string[]), ...extraDos]));
  const dontList = Array.from(
    new Set([...(row.dontList as string[]), ...extraDonts]),
  );

  await prisma.agentPlaybook.update({
    where: { id: "mystery-thumb-agent" },
    data: { thumbnailFormats: formats, doList, dontList },
  });

  const file = JSON.parse(await readFile("data/mystery-playbook.json", "utf8"));
  file.thumbnailFormats = formats;
  file.doList = doList;
  file.dontList = dontList;
  await writeFile("data/mystery-playbook.json", JSON.stringify(file, null, 2));
  console.log("playbook patched", {
    formats: formats.length,
    doList: doList.length,
    dontList: dontList.length,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
