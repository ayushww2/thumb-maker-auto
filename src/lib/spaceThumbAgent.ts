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
import {
  THUMB_QUALITY_SYSTEM_RULES,
  THUMB_RENDER_QUALITY,
} from "@/lib/thumbRenderQuality";

export const SPACE_NICHE = "space";
export const SPACE_MIN_VIEWS = 100_000;
export const SPACE_AGENT_ID = "space-thumb-agent";

export type SpaceCompetitor = {
  youtubeId: string;
  title: string;
  viewCount: number;
  thumbnailUrl: string;
  videoUrl: string;
  channelName: string;
  score: number;
  isFormatReference?: boolean;
};

export type SpacePlaybook = {
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

export type SpaceAgentResult = {
  agent: typeof SPACE_AGENT_ID;
  title: string;
  playbook: SpacePlaybook;
  competitors: SpaceCompetitor[];
  formatReference: SpaceCompetitor & { layoutBlueprint: string };
  analysis: string;
  chosenFormat: string;
  overlayText: string;
  discoveryPlan: string;
  imagePrompt: string;
  generatePrompt: string;
  whyTheseComps: string;
};

const PLAYBOOK_PATH = path.join(process.cwd(), "data", "space-playbook.json");
const SCAN_LIMIT = 20;

function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let raw = (fenced?.[1] || text).trim();
  raw = raw.replace(/^[^{]*/, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Space agent returned no JSON object: ${text.slice(0, 240)}`);
  }
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

async function loadSpaceVideos() {
  return prisma.video.findMany({
    where: { niche: SPACE_NICHE, viewCount: { gte: SPACE_MIN_VIEWS } },
    include: { channel: true, thumbScan: true },
    orderBy: { viewCount: "desc" },
  });
}

async function loadCachedSpacePlaybook(): Promise<SpacePlaybook | null> {
  try {
    const row = await prisma.agentPlaybook.findUnique({
      where: { id: SPACE_AGENT_ID },
    });
    if (row?.summary) {
      return {
        generatedAt: row.generatedAt.toISOString(),
        niche: SPACE_NICHE,
        minViews: SPACE_MIN_VIEWS,
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
    return JSON.parse(await readFile(PLAYBOOK_PATH, "utf8")) as SpacePlaybook;
  } catch {
    return null;
  }
}

async function persistSpacePlaybook(playbook: SpacePlaybook) {
  await mkdir(path.dirname(PLAYBOOK_PATH), { recursive: true });
  await writeFile(PLAYBOOK_PATH, JSON.stringify(playbook, null, 2));

  await prisma.agentPlaybook.upsert({
    where: { id: SPACE_AGENT_ID },
    create: {
      id: SPACE_AGENT_ID,
      agent: SPACE_AGENT_ID,
      summary: playbook.summary,
      viralPatterns: playbook.viralPatterns,
      lowViewPatterns: [],
      thumbnailFormats: playbook.thumbnailFormats,
      titleFormulas: playbook.titleFormulas,
      doList: playbook.doList,
      dontList: playbook.dontList,
      viralThreshold: playbook.viralThreshold,
      lowThreshold: SPACE_MIN_VIEWS,
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
    const key = "collection/space/playbook.json";
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
      where: { id: SPACE_AGENT_ID },
      data: { r2Key: key, r2Url: playbook.r2Url },
    });
    await writeFile(PLAYBOOK_PATH, JSON.stringify(playbook, null, 2));
  }
}

async function scanSpaceThumb(input: {
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
            text: `You are Space Thumb Agent studying a Space competitor YouTube thumbnail.
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
  "whyItWorks": "why this space/mystery clickbait package works"
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

export async function buildSpacePlaybook(force = false): Promise<SpacePlaybook> {
  if (!force) {
    const cached = await loadCachedSpacePlaybook();
    if (cached?.summary) return cached;
  }

  const videos = await loadSpaceVideos();
  if (!videos.length) {
    throw new Error(
      "No Space videos ≥100K found. Run seed-space-collection first.",
    );
  }

  const scanTargets = videos.slice(0, SCAN_LIMIT);
  const visualLessons: SpacePlaybook["visualLessons"] = [];
  for (const v of scanTargets) {
    try {
      const lesson = await scanSpaceThumb({
        youtubeId: v.youtubeId,
        title: v.title,
        viewCount: v.viewCount,
        thumbnailUrl: v.r2ThumbnailUrl || v.thumbnailUrl,
        videoDbId: v.id,
      });
      visualLessons.push(lesson);
      console.log("[space-agent] scanned", v.youtubeId, v.viewCount);
    } catch (err) {
      console.warn(
        "[space-agent] scan failed",
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
        content: `You are Space Thumb Agent.
You train ONLY on Space competitor titles + thumbnail vision scans (≥100K views).
Niche themes: NASA finds, planets (Jupiter/Pluto/Io/Venus), edge of universe, Planet 9, cosmic anomalies, telescopes, spacecraft imagery.
Return STRICT JSON only:
{
  "summary": "2-4 sentences on what makes Space thumbs/titles win",
  "viralPatterns": ["..."],
  "thumbnailFormats": ["composition formats from scans"],
  "titleFormulas": ["title formulas from this niche only"],
  "doList": ["rules for making space thumbs"],
  "dontList": ["what to avoid — including non-space niches, clay/biblical content, ancient tablets"]
}`,
      },
      {
        role: "user",
        content: `Space collection: ${videos.length} videos (≥${SPACE_MIN_VIEWS} views).

TOP TITLES:
${titleLines}

VISUAL SCAN NOTES (real space competitor thumbs):
${scanLines || "(no scans)"}

Build the Space Thumb playbook JSON now. Use ONLY this space niche evidence. Never mention clay, tablets, or biblical niches.`,
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

  const playbook: SpacePlaybook = {
    generatedAt: new Date().toISOString(),
    niche: SPACE_NICHE,
    minViews: SPACE_MIN_VIEWS,
    sampleSize: videos.length,
    viralThreshold: SPACE_MIN_VIEWS,
    scanCount: visualLessons.length,
    summary: parsed.summary,
    viralPatterns: parsed.viralPatterns || [],
    thumbnailFormats: parsed.thumbnailFormats || [],
    titleFormulas: parsed.titleFormulas || [],
    doList: parsed.doList || [],
    dontList: parsed.dontList || [],
    visualLessons,
  };

  await persistSpacePlaybook(playbook);
  return playbook;
}

export async function pickSpaceFormatReference(title: string) {
  const videos = await loadSpaceVideos();
  if (!videos.length) {
    throw new Error("No Space format references in DB");
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
            text: `This is a Space FORMAT REFERENCE thumbnail.
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
  if (!text) throw new Error("Failed to extract space layout blueprint");
  return text;
}

export async function runSpaceThumbAgent(input: {
  title: string;
  notes?: string;
}): Promise<SpaceAgentResult> {
  const title = input.title.trim();
  if (!title) throw new Error("Title is required");

  const [playbook, picked] = await Promise.all([
    buildSpacePlaybook(false),
    pickSpaceFormatReference(title),
  ]);
  const layoutBlueprint = await extractLayoutBlueprint(
    picked.reference.thumbnailUrl,
  );

  const completion = await createReasoningCompletion({
    temperature: 0.62,
    messages: [
      {
        role: "system",
        content: `You are Space Thumb Agent.
Train/generate ONLY from Space competitor titles + thumbs (≥100K).
Copy LAYOUT from the format reference; invent new space-niche discovery content for the new title (planets, NASA finds, cosmic anomalies).

${THUMB_QUALITY_SYSTEM_RULES}

Return STRICT JSON only:
{
  "analysis": "why this space format fits",
  "chosenFormat": "short format name",
  "overlayText": "3-6 word ALL-CAPS punch line (keep the strong thick punch-text style)",
  "discoveryPlan": "photoreal, unique, lightly-lit space/cosmos discovery visual specific to THIS title — name concrete materials/lighting",
  "imagePrompt": "edit instruction: use uploaded image as layout template only; replace subjects/text for new title; keep 16:9; thick markers if present; photoreal + lighter objects + sharp text",
  "whyTheseComps": "why this space format reference"
}`
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `NEW TITLE: ${title}
${input.notes?.trim() ? `EXTRA: ${input.notes.trim()}` : ""}

SPACE FORMAT REFERENCE (layout only):
${picked.reference.title} | ${picked.reference.viewCount} views
${picked.reference.thumbnailUrl}

LAYOUT BLUEPRINT:
${layoutBlueprint}

SPACE PLAYBOOK (from space titles/thumbs only):
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
    "Using the uploaded Space thumbnail ONLY as a LAYOUT TEMPLATE, create a brand-new original 16:9 YouTube thumbnail.",
    "Match composition grammar from the space competitor set only — but invent unique title-specific subjects/props (do not clone the reference artifact).",
    `Sell ONLY this title: ${title}`,
    "Output must be 16:9 (1280x720).",
    parsed.imagePrompt.trim(),
    parsed.overlayText
      ? `Banner text exactly (keep it thick, ultra-sharp, high-contrast): ${parsed.overlayText.trim()}`
      : "",
    parsed.discoveryPlan
      ? `Discovery content (unique + photoreal + lightly lit): ${parsed.discoveryPlan.trim()}`
      : "",
    THUMB_RENDER_QUALITY,
  ]
    .filter(Boolean)
    .join(" ");

  const generatePrompt = [
    "Create an original photoreal 16:9 Space YouTube thumbnail (1280x720).",
    `Title: ${title}`,
    parsed.chosenFormat ? `Format: ${parsed.chosenFormat}` : "",
    "Base style ONLY on Space viral packages (NASA discoveries, planets, cosmic edges, anomalous space objects).",
    "Invent unique title-specific discovery details — distinct materials, markings, and lighting so it does not feel generic.",
    parsed.overlayText
      ? `Banner (thick sharp ALL-CAPS punch text): ${parsed.overlayText}`
      : "",
    parsed.discoveryPlan
      ? `Discovery (lighter objects, clean highlights): ${parsed.discoveryPlan}`
      : "",
    `Layout blueprint: ${layoutBlueprint}`,
    THUMB_RENDER_QUALITY,
    "No watermarks, no channel logos, no YouTube UI.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    agent: SPACE_AGENT_ID,
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

export async function generateWithSpaceAgent(input: {
  title: string;
  notes?: string;
}) {
  const brief = await runSpaceThumbAgent(input);
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
        "[space-agent] edit failed",
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

export async function getSpaceAgentStatus() {
  const [playbookRow, videoCount, scanCount] = await Promise.all([
    prisma.agentPlaybook.findUnique({ where: { id: SPACE_AGENT_ID } }),
    prisma.video.count({
      where: { niche: SPACE_NICHE, viewCount: { gte: SPACE_MIN_VIEWS } },
    }),
    prisma.thumbScan.count({
      where: { video: { niche: SPACE_NICHE, viewCount: { gte: SPACE_MIN_VIEWS } } },
    }),
  ]);
  return {
    agent: SPACE_AGENT_ID,
    niche: SPACE_NICHE,
    minViews: SPACE_MIN_VIEWS,
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
      : await loadCachedSpacePlaybook(),
  };
}
