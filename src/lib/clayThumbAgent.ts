import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/db";
import {
  createReasoningCompletion,
  generateThumbnailFromReference,
  generateThumbnailImage,
} from "@/lib/contactbox";
import { getR2Config, getReasoningModel } from "@/lib/env";
import { toYouTube16x9 } from "@/lib/imageSize";
import { scoreCompetitor } from "@/lib/textSimilarity";

export const CLAY_NICHE = "clay-mysteries";
export const CLAY_MIN_VIEWS = 100_000;
export const CLAY_AGENT_ID = "clay-thumb-agent";

export type ClayCompetitor = {
  youtubeId: string;
  title: string;
  viewCount: number;
  thumbnailUrl: string;
  videoUrl: string;
  channelName: string;
  score: number;
  isFormatReference?: boolean;
};

export type ClayPlaybook = {
  generatedAt: string;
  niche: string;
  minViews: number;
  sampleSize: number;
  viralThreshold: number;
  scanCount: number;
  summary: string;
  viralPatterns: string[];
  thumbnailFormats: string[];
  titleFormulas: string[];
  doList: string[];
  dontList: string[];
  visualLessons: Array<{
    youtubeId: string;
    title: string;
    viewCount: number;
    subject: string;
    composition: string;
    colors: string;
    overlayText: string;
    emotionalHook: string;
    formatLabel: string;
    whyItWorks: string;
    thumbnailUrl: string;
  }>;
  r2Url?: string | null;
};

export type ClayAgentResult = {
  agent: typeof CLAY_AGENT_ID;
  title: string;
  playbook: ClayPlaybook;
  competitors: ClayCompetitor[];
  formatReference: ClayCompetitor & { layoutBlueprint: string };
  analysis: string;
  chosenFormat: string;
  overlayText: string;
  discoveryPlan: string;
  imagePrompt: string;
  generatePrompt: string;
  whyTheseComps: string;
};

const PLAYBOOK_PATH = path.join(process.cwd(), "data", "clay-playbook.json");
const SCAN_LIMIT = 20;

function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let raw = (fenced?.[1] || text).trim();
  raw = raw.replace(/^[^{]*/, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Clay agent returned no JSON object: ${text.slice(0, 240)}`);
  }
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

async function loadClayVideos() {
  return prisma.video.findMany({
    where: { niche: CLAY_NICHE, viewCount: { gte: CLAY_MIN_VIEWS } },
    include: { channel: true, thumbScan: true },
    orderBy: { viewCount: "desc" },
  });
}

async function loadCachedPlaybook(): Promise<ClayPlaybook | null> {
  try {
    const row = await prisma.agentPlaybook.findUnique({
      where: { id: CLAY_AGENT_ID },
    });
    if (row?.summary) {
      return {
        generatedAt: row.generatedAt.toISOString(),
        niche: CLAY_NICHE,
        minViews: CLAY_MIN_VIEWS,
        sampleSize: row.sampleSize,
        viralThreshold: row.viralThreshold,
        scanCount: row.scanCount,
        summary: row.summary,
        viralPatterns: row.viralPatterns as string[],
        thumbnailFormats: row.thumbnailFormats as string[],
        titleFormulas: row.titleFormulas as string[],
        doList: row.doList as string[],
        dontList: row.dontList as string[],
        visualLessons: [],
        r2Url: row.r2Url,
      };
    }
  } catch {
    // ignore
  }
  try {
    return JSON.parse(await readFile(PLAYBOOK_PATH, "utf8")) as ClayPlaybook;
  } catch {
    return null;
  }
}

async function persistPlaybook(playbook: ClayPlaybook) {
  await mkdir(path.dirname(PLAYBOOK_PATH), { recursive: true });
  await writeFile(PLAYBOOK_PATH, JSON.stringify(playbook, null, 2));

  await prisma.agentPlaybook.upsert({
    where: { id: CLAY_AGENT_ID },
    create: {
      id: CLAY_AGENT_ID,
      agent: CLAY_AGENT_ID,
      summary: playbook.summary,
      viralPatterns: playbook.viralPatterns,
      lowViewPatterns: [],
      thumbnailFormats: playbook.thumbnailFormats,
      titleFormulas: playbook.titleFormulas,
      doList: playbook.doList,
      dontList: playbook.dontList,
      viralThreshold: playbook.viralThreshold,
      lowThreshold: CLAY_MIN_VIEWS,
      sampleSize: playbook.sampleSize,
      viralCount: playbook.sampleSize,
      lowCount: 0,
      scanCount: playbook.scanCount,
      generatedAt: new Date(playbook.generatedAt),
    },
    update: {
      summary: playbook.summary,
      viralPatterns: playbook.viralPatterns,
      thumbnailFormats: playbook.thumbnailFormats,
      titleFormulas: playbook.titleFormulas,
      doList: playbook.doList,
      dontList: playbook.dontList,
      viralThreshold: playbook.viralThreshold,
      sampleSize: playbook.sampleSize,
      viralCount: playbook.sampleSize,
      scanCount: playbook.scanCount,
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
        ContentType: "application/json; charset=utf-8",
      }),
    );
    playbook.r2Url = `${r2.publicBaseUrl}/${key}`;
    await prisma.agentPlaybook.update({
      where: { id: CLAY_AGENT_ID },
      data: { r2Key: key, r2Url: playbook.r2Url },
    });
    await writeFile(PLAYBOOK_PATH, JSON.stringify(playbook, null, 2));
  }
}

async function scanClayThumb(input: {
  youtubeId: string;
  title: string;
  viewCount: number;
  thumbnailUrl: string;
  videoDbId: string;
}) {
  const completion = await createReasoningCompletion({
    temperature: 0.2,
    max_tokens: 700,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You are Clay Thumbnail Agent studying a Clay Mysteries competitor YouTube thumbnail.
ONLY describe what is visible. This niche is ancient tablets / Enoch / Sumerian / biblical AI reveals / sealed chambers.

Title: ${input.title}
Views: ${input.viewCount}

Return STRICT JSON only:
{
  "subject": "main subject(s)",
  "composition": "layout zones left/right/center",
  "colors": "palette / grade",
  "overlayText": "on-image text if any",
  "emotionalHook": "why the eye stops",
  "formatLabel": "short format name",
  "whyItWorks": "why this clay/mystery clickbait package works"
}`,
          },
          { type: "image_url", image_url: { url: input.thumbnailUrl } },
        ] as never,
      },
    ],
  });
  const content = completion.choices[0]?.message?.content?.trim() || "";
  const parsed = extractJson<{
    subject: string;
    composition: string;
    colors: string;
    overlayText: string;
    emotionalHook: string;
    formatLabel: string;
    whyItWorks: string;
  }>(content);

  await prisma.thumbScan.upsert({
    where: { videoId: input.videoDbId },
    create: {
      videoId: input.videoDbId,
      tier: input.viewCount >= 500_000 ? "viral" : "mid",
      subject: parsed.subject || "",
      composition: parsed.composition || "",
      colors: parsed.colors || "",
      overlayText: parsed.overlayText || "",
      emotionalHook: parsed.emotionalHook || "",
      formatLabel: parsed.formatLabel || "",
      whyItWorks: parsed.whyItWorks || "",
      rawNotes: content,
      model: getReasoningModel(),
    },
    update: {
      tier: input.viewCount >= 500_000 ? "viral" : "mid",
      subject: parsed.subject || "",
      composition: parsed.composition || "",
      colors: parsed.colors || "",
      overlayText: parsed.overlayText || "",
      emotionalHook: parsed.emotionalHook || "",
      formatLabel: parsed.formatLabel || "",
      whyItWorks: parsed.whyItWorks || "",
      rawNotes: content,
      model: getReasoningModel(),
    },
  });

  return {
    youtubeId: input.youtubeId,
    title: input.title,
    viewCount: input.viewCount,
    subject: parsed.subject || "",
    composition: parsed.composition || "",
    colors: parsed.colors || "",
    overlayText: parsed.overlayText || "",
    emotionalHook: parsed.emotionalHook || "",
    formatLabel: parsed.formatLabel || "",
    whyItWorks: parsed.whyItWorks || "",
    thumbnailUrl: input.thumbnailUrl,
  };
}

export async function buildClayPlaybook(force = false): Promise<ClayPlaybook> {
  if (!force) {
    const cached = await loadCachedPlaybook();
    if (cached?.summary) return cached;
  }

  const videos = await loadClayVideos();
  if (!videos.length) {
    throw new Error(
      "No Clay Mysteries videos ≥100K found. Run seed-clay-collection first.",
    );
  }

  const scanTargets = videos.slice(0, SCAN_LIMIT);
  const visualLessons: ClayPlaybook["visualLessons"] = [];
  for (const v of scanTargets) {
    try {
      const lesson = await scanClayThumb({
        youtubeId: v.youtubeId,
        title: v.title,
        viewCount: v.viewCount,
        thumbnailUrl: v.r2ThumbnailUrl || v.thumbnailUrl,
        videoDbId: v.id,
      });
      visualLessons.push(lesson);
      console.log("[clay-agent] scanned", v.youtubeId, v.viewCount);
    } catch (err) {
      console.warn(
        "[clay-agent] scan failed",
        v.youtubeId,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const titleLines = videos
    .slice(0, 40)
    .map((v, i) => `${i + 1}. [${v.viewCount}] ${v.title}`)
    .join("\n");
  const scanLines = visualLessons
    .map(
      (l, i) =>
        `${i + 1}. [${l.viewCount}] ${l.title}
format=${l.formatLabel}
subject=${l.subject}
composition=${l.composition}
text=${l.overlayText}
lesson=${l.whyItWorks}`,
    )
    .join("\n\n");

  const completion = await createReasoningCompletion({
    temperature: 0.35,
    messages: [
      {
        role: "system",
        content: `You are Clay Thumbnail Agent.
You train ONLY on Clay Mysteries competitor titles + thumbnail vision scans (≥100K views).
Niche themes: Sumerian tablets, Book of Enoch, Ethiopian Bible, sealed chambers, AI reanalysis of ancient texts, underground humans, biblical contradictions via Grok/AI.
Return STRICT JSON only:
{
  "summary": "2-4 sentences on what makes Clay Mysteries thumbs/titles win",
  "viralPatterns": ["..."],
  "thumbnailFormats": ["composition formats from scans"],
  "titleFormulas": ["title formulas from this niche only"],
  "doList": ["rules for making clay thumbs"],
  "dontList": ["what to avoid — including non-clay niches"]
}`,
      },
      {
        role: "user",
        content: `Clay Mysteries collection: ${videos.length} videos (≥${CLAY_MIN_VIEWS} views).

TOP TITLES:
${titleLines}

VISUAL SCAN NOTES (real clay competitor thumbs):
${scanLines || "(no scans)"}

Build the Clay Thumbnail playbook JSON now. Use ONLY this clay niche evidence.`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content?.trim() || "";
  const parsed = extractJson<{
    summary: string;
    viralPatterns: string[];
    thumbnailFormats: string[];
    titleFormulas: string[];
    doList: string[];
    dontList: string[];
  }>(content);

  const playbook: ClayPlaybook = {
    generatedAt: new Date().toISOString(),
    niche: CLAY_NICHE,
    minViews: CLAY_MIN_VIEWS,
    sampleSize: videos.length,
    viralThreshold: CLAY_MIN_VIEWS,
    scanCount: visualLessons.length,
    summary: parsed.summary,
    viralPatterns: parsed.viralPatterns || [],
    thumbnailFormats: parsed.thumbnailFormats || [],
    titleFormulas: parsed.titleFormulas || [],
    doList: parsed.doList || [],
    dontList: parsed.dontList || [],
    visualLessons,
  };

  await persistPlaybook(playbook);
  return playbook;
}

export async function pickClayFormatReference(title: string) {
  const videos = await loadClayVideos();
  if (!videos.length) {
    throw new Error("No Clay Mysteries format references in DB");
  }
  const scored = videos.map((v) => {
    const score = scoreCompetitor({
      query: title,
      title: v.title,
      viewCount: v.viewCount,
    });
    return {
      youtubeId: v.youtubeId,
      title: v.title,
      viewCount: v.viewCount,
      thumbnailUrl: v.r2ThumbnailUrl || v.thumbnailUrl,
      videoUrl: v.videoUrl,
      channelName: v.channel.name,
      score,
      fitness: score * 0.45 + Math.min(0.55, Math.log10(v.viewCount + 1) / 12),
    };
  });
  scored.sort((a, b) => b.fitness - a.fitness || b.viewCount - a.viewCount);
  const reference = { ...scored[0], isFormatReference: true };
  const shortlist = scored.slice(0, 5).map(({ fitness: _f, ...rest }) => rest);
  return { reference, shortlist, candidates: scored.slice(0, 8) };
}

async function extractLayoutBlueprint(thumbnailUrl: string) {
  const completion = await createReasoningCompletion({
    temperature: 0.1,
    max_tokens: 700,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `This is a Clay Mysteries FORMAT REFERENCE thumbnail.
Extract LAYOUT BLUEPRINT only (zones/graphics). Ignore face identity.
- 16:9 zones with %
- where tablet/artifact/AI subject sits
- text / banner placement
- red arrow/circle if present
Return tight bullets, no intro.`,
          },
          { type: "image_url", image_url: { url: thumbnailUrl } },
        ] as never,
      },
    ],
  });
  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("Failed to extract clay layout blueprint");
  return text;
}

export async function runClayThumbAgent(input: {
  title: string;
  notes?: string;
}): Promise<ClayAgentResult> {
  const title = input.title.trim();
  if (!title) throw new Error("Title is required");

  const [playbook, picked] = await Promise.all([
    buildClayPlaybook(false),
    pickClayFormatReference(title),
  ]);
  const layoutBlueprint = await extractLayoutBlueprint(
    picked.reference.thumbnailUrl,
  );

  const completion = await createReasoningCompletion({
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content: `You are Clay Thumbnail Agent.
Train/generate ONLY from Clay Mysteries competitor titles + thumbs (≥100K).
Copy LAYOUT from the format reference; invent new clay-niche discovery content for the new title.

Return STRICT JSON only:
{
  "analysis": "why this clay format fits",
  "chosenFormat": "short format name",
  "overlayText": "3-6 word ALL-CAPS punch line",
  "discoveryPlan": "photoreal clay/ancient discovery visual for THIS title",
  "imagePrompt": "edit instruction: use uploaded image as layout template only; replace subjects/text for new title; keep 16:9; thick markers if present",
  "whyTheseComps": "why this clay format reference"
}`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `NEW TITLE: ${title}
${input.notes?.trim() ? `EXTRA: ${input.notes.trim()}` : ""}

CLAY FORMAT REFERENCE (layout only):
${picked.reference.title} | ${picked.reference.viewCount} views
${picked.reference.thumbnailUrl}

LAYOUT BLUEPRINT:
${layoutBlueprint}

CLAY PLAYBOOK (from clay titles/thumbs only):
${playbook.summary}
VIRAL:
${playbook.viralPatterns.map((p) => `- ${p}`).join("\n")}
FORMATS:
${playbook.thumbnailFormats.map((p) => `- ${p}`).join("\n")}
DO:
${playbook.doList.map((p) => `- ${p}`).join("\n")}
DON'T:
${playbook.dontList.map((p) => `- ${p}`).join("\n")}

Produce JSON now.`,
          },
          {
            type: "image_url",
            image_url: { url: picked.reference.thumbnailUrl },
          },
        ] as never,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content?.trim() || "";
  const parsed = extractJson<{
    analysis: string;
    chosenFormat: string;
    overlayText: string;
    discoveryPlan: string;
    imagePrompt: string;
    whyTheseComps: string;
  }>(content);

  const imagePrompt = [
    "Using the uploaded Clay Mysteries thumbnail ONLY as a LAYOUT TEMPLATE, create a brand-new original 16:9 YouTube thumbnail.",
    "Match composition grammar from the clay competitor set only.",
    `Sell ONLY this title: ${title}`,
    "Output must be 16:9 (1280x720).",
    parsed.imagePrompt.trim(),
    parsed.overlayText
      ? `Banner text exactly: ${parsed.overlayText.trim()}`
      : "",
    parsed.discoveryPlan
      ? `Discovery content: ${parsed.discoveryPlan.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const generatePrompt = [
    "Create an original photoreal 16:9 Clay Mysteries YouTube thumbnail (1280x720).",
    `Title: ${title}`,
    parsed.chosenFormat ? `Format: ${parsed.chosenFormat}` : "",
    "Base style ONLY on Clay Mysteries viral packages (ancient tablets, sealed knowledge, AI/biblical reveals).",
    parsed.overlayText ? `Banner: ${parsed.overlayText}` : "",
    parsed.discoveryPlan ? `Discovery: ${parsed.discoveryPlan}` : "",
    `Layout blueprint: ${layoutBlueprint}`,
    "No watermarks, no channel logos, no YouTube UI.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    agent: CLAY_AGENT_ID,
    title,
    playbook,
    competitors: picked.shortlist,
    formatReference: {
      ...picked.reference,
      layoutBlueprint,
    },
    analysis: parsed.analysis,
    chosenFormat: parsed.chosenFormat,
    overlayText: parsed.overlayText || "",
    discoveryPlan: parsed.discoveryPlan || "",
    imagePrompt,
    generatePrompt,
    whyTheseComps: parsed.whyTheseComps,
  };
}

export async function generateWithClayAgent(input: {
  title: string;
  notes?: string;
}) {
  const brief = await runClayThumbAgent(input);
  let image: Buffer | null = null;
  let usedRef = brief.formatReference;

  const refs = [
    brief.formatReference,
    ...brief.competitors.filter(
      (c) => c.youtubeId !== brief.formatReference.youtubeId,
    ),
  ].slice(0, 4);

  for (const ref of refs) {
    try {
      image = await generateThumbnailFromReference({
        prompt: brief.imagePrompt,
        referenceImageUrl: ref.thumbnailUrl,
      });
      usedRef = {
        ...brief.formatReference,
        ...ref,
        layoutBlueprint: brief.formatReference.layoutBlueprint,
      };
      break;
    } catch (err) {
      console.warn(
        "[clay-agent] edit failed",
        ref.youtubeId,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (!image) {
    image = await generateThumbnailImage(brief.generatePrompt);
  }

  image = await toYouTube16x9(image);
  return {
    brief: {
      ...brief,
      formatReference: usedRef,
      competitors: brief.competitors.map((c) =>
        c.youtubeId === usedRef.youtubeId
          ? { ...c, isFormatReference: true }
          : c,
      ),
    },
    image,
  };
}

export async function getClayAgentStatus() {
  const [playbookRow, videoCount, scanCount] = await Promise.all([
    prisma.agentPlaybook.findUnique({ where: { id: CLAY_AGENT_ID } }),
    prisma.video.count({
      where: { niche: CLAY_NICHE, viewCount: { gte: CLAY_MIN_VIEWS } },
    }),
    prisma.thumbScan.count({
      where: { video: { niche: CLAY_NICHE, viewCount: { gte: CLAY_MIN_VIEWS } } },
    }),
  ]);
  return {
    agent: CLAY_AGENT_ID,
    niche: CLAY_NICHE,
    minViews: CLAY_MIN_VIEWS,
    trained: Boolean(playbookRow?.summary),
    videoCount,
    scanCount,
    playbook: playbookRow
      ? {
          summary: playbookRow.summary,
          generatedAt: playbookRow.generatedAt,
          sampleSize: playbookRow.sampleSize,
          scanCount: playbookRow.scanCount,
          r2Url: playbookRow.r2Url,
          viralPatterns: playbookRow.viralPatterns,
          thumbnailFormats: playbookRow.thumbnailFormats,
        }
      : await loadCachedPlaybook(),
  };
}
