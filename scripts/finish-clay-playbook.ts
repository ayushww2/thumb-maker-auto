/**
 * Finish Clay playbook using already-saved thumb scans (skip re-scanning).
 */
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "../src/lib/db";
import { createReasoningCompletion } from "../src/lib/contactbox";
import { getR2Config } from "../src/lib/env";
import type { ClayPlaybook } from "../src/lib/clayThumbAgent";

const CLAY_NICHE = "clay-mysteries";
const CLAY_MIN = 100_000;
const ID = "clay-thumb-agent";

function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let raw = (fenced?.[1] || text).trim();
  // strip common preamble
  raw = raw.replace(/^[^{]*/, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Clay agent returned no JSON object: ${text.slice(0, 240)}`);
  }
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

async function main() {
  const videos = await prisma.video.findMany({
    where: { niche: CLAY_NICHE, viewCount: { gte: CLAY_MIN } },
    include: { thumbScan: true },
    orderBy: { viewCount: "desc" },
  });
  const scans = videos.filter((v) => v.thumbScan);
  console.log(`videos=${videos.length} scans=${scans.length}`);

  const titleLines = videos
    .slice(0, 40)
    .map((v, i) => `${i + 1}. [${v.viewCount}] ${v.title}`)
    .join("\n");
  const scanLines = scans
    .map((v, i) => {
      const s = v.thumbScan!;
      return `${i + 1}. [${v.viewCount}] ${v.title}
format=${s.formatLabel}
subject=${s.subject}
composition=${s.composition}
text=${s.overlayText}
lesson=${s.whyItWorks}`;
    })
    .join("\n\n");

  const completion = await createReasoningCompletion({
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `You are Clay Thumbnail Agent.
Return ONLY a single JSON object. No markdown fences. No prose before/after.
Keys required:
{"summary":"string","viralPatterns":["string"],"thumbnailFormats":["string"],"titleFormulas":["string"],"doList":["string"],"dontList":["string"]}`,
      },
      {
        role: "user",
        content: `Clay Mysteries collection: ${videos.length} videos (>=${CLAY_MIN} views).

TOP TITLES:
${titleLines}

VISUAL SCAN NOTES (clay competitor thumbs only):
${scanLines || "(no scans)"}

Return the JSON object now.`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content?.trim() || "";
  console.log("model reply head:", content.slice(0, 180));
  const parsed = extractJson<{
    summary: string;
    viralPatterns: string[];
    thumbnailFormats: string[];
    titleFormulas: string[];
    doList: string[];
    dontList: string[];
  }>(content);

  const visualLessons = scans.map((v) => ({
    youtubeId: v.youtubeId,
    title: v.title,
    viewCount: v.viewCount,
    subject: v.thumbScan!.subject || "",
    composition: v.thumbScan!.composition || "",
    colors: v.thumbScan!.colors || "",
    overlayText: v.thumbScan!.overlayText || "",
    emotionalHook: v.thumbScan!.emotionalHook || "",
    formatLabel: v.thumbScan!.formatLabel || "",
    whyItWorks: v.thumbScan!.whyItWorks || "",
    thumbnailUrl: v.r2ThumbnailUrl || v.thumbnailUrl,
  }));

  const playbook: ClayPlaybook = {
    generatedAt: new Date().toISOString(),
    niche: CLAY_NICHE,
    minViews: CLAY_MIN,
    sampleSize: videos.length,
    viralThreshold: CLAY_MIN,
    scanCount: visualLessons.length,
    summary: parsed.summary,
    viralPatterns: parsed.viralPatterns || [],
    thumbnailFormats: parsed.thumbnailFormats || [],
    titleFormulas: parsed.titleFormulas || [],
    doList: parsed.doList || [],
    dontList: parsed.dontList || [],
    visualLessons,
  };

  await mkdir(path.join(process.cwd(), "data"), { recursive: true });
  const localPath = path.join(process.cwd(), "data", "clay-playbook.json");
  await writeFile(localPath, JSON.stringify(playbook, null, 2));

  await prisma.agentPlaybook.upsert({
    where: { id: ID },
    create: {
      id: ID,
      agent: ID,
      summary: playbook.summary,
      viralPatterns: playbook.viralPatterns,
      lowViewPatterns: [],
      thumbnailFormats: playbook.thumbnailFormats,
      titleFormulas: playbook.titleFormulas,
      doList: playbook.doList,
      dontList: playbook.dontList,
      viralThreshold: CLAY_MIN,
      lowThreshold: CLAY_MIN,
      sampleSize: videos.length,
      viralCount: videos.length,
      lowCount: 0,
      scanCount: visualLessons.length,
      generatedAt: new Date(playbook.generatedAt),
    },
    update: {
      summary: playbook.summary,
      viralPatterns: playbook.viralPatterns,
      thumbnailFormats: playbook.thumbnailFormats,
      titleFormulas: playbook.titleFormulas,
      doList: playbook.doList,
      dontList: playbook.dontList,
      sampleSize: videos.length,
      viralCount: videos.length,
      scanCount: visualLessons.length,
      generatedAt: new Date(playbook.generatedAt),
    },
  });

  const r2 = getR2Config();
  if (r2.configured) {
    const key = "collection/clay/playbook.json";
    const client = new S3Client({
      region: "auto",
      endpoint: r2.endpoint,
      credentials: {
        accessKeyId: r2.accessKeyId,
        secretAccessKey: r2.secretAccessKey,
      },
    });
    await client.send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: key,
        Body: Buffer.from(JSON.stringify(playbook, null, 2)),
        ContentType: "application/json",
      }),
    );
    const r2Url = `${r2.publicBaseUrl}/${key}`;
    playbook.r2Url = r2Url;
    await prisma.agentPlaybook.update({
      where: { id: ID },
      data: { r2Key: key, r2Url },
    });
    await writeFile(localPath, JSON.stringify(playbook, null, 2));
    console.log("r2Url", r2Url);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        sampleSize: playbook.sampleSize,
        scanCount: playbook.scanCount,
        summary: playbook.summary,
        formats: playbook.thumbnailFormats.slice(0, 3),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
