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
    max_tokens: 900,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `This is a real Space YouTube FORMAT REFERENCE thumbnail (≥100K).
Extract a COMP-FAITHFUL BLUEPRINT for cloning the package (not the exact subject).
Include:
- 16:9 zones with %
- where planet/spacecraft/terrain/anomaly sits
- EXACT text placement (top strip / lower third / left stack / corner brand)
- TEXT STYLE: color (white/yellow/etc), stroke/shadow, weight, casing, word count feel
- border/frame if present
- red arrow/circle/markers if present
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

const SPACE_COMP_TEXT_LOCK = [
  "SPACE TEXT LOCK (mandatory — look like real competitor space thumbs, not AI text):",
  "Copy the REFERENCE text STYLE heavily: same placement zone, same casing energy, same weight, same fill color family (usually thick white or yellow ALL-CAPS), same hard black outline/shadow.",
  "Text must look printed/composited on a real YouTube thumbnail — clean bold geometric sans, perfectly crisp edges, slight natural compression — NOT glowing neon, NOT metallic 3D chrome, NOT bubbly AI letters, NOT soft plastic type, NOT warped glyphs.",
  "Keep punch lines SHORT like the comps: 2-5 blunt words (THIS IS JUPITER / WHAT NASA SAW / NASA'S PLAN / NOTHING). No long sentences. No tiny captions.",
  "Letters must stay upright, evenly spaced, and razor-sharp at phone size — text is the #1 readability priority.",
  "Do not invent fancy fonts; match the reference's simple high-contrast youtube-thumb typography.",
].join(" ");

/** Normalize overlay to short blunt ALL-CAPS like real space comps. */
function normalizeSpaceOverlayText(raw: string, title: string): string {
  const cleaned = raw
    .replace(/["'`]/g, "")
    .replace(/[^a-zA-Z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 5);
  if (words.length >= 2) return words.join(" ");
  const fromTitle = title
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(" ")
    .toUpperCase();
  return fromTitle || "THIS IS SPACE";
}

const SPACE_COMP_FIDELITY_LOCK = [
  "COMP FIDELITY LOCK (mandatory):",
  "Heavily inspire from the uploaded competitor thumbnail: keep the SAME layout grammar, subject scale, text zone, border/frame treatment, and marker language (arrow/circle) when present.",
  "Swap only the discovery subject + headline words to fit the NEW title — the package should still feel like that same Space channel style family.",
  "Prefer documentary / archival / NASA-footage realism from the comps over generic glossy sci-fi CGI.",
].join(" ");

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

  const playbookBrief = {
    summary: playbook.summary,
    viral: playbook.viralPatterns.slice(0, 6),
    formats: playbook.thumbnailFormats.slice(0, 6),
    doList: playbook.doList.slice(0, 8),
    dontList: playbook.dontList.slice(0, 8),
  };

  async function requestBrief() {
    return createReasoningCompletion({
      temperature: 0.4,
      max_tokens: 1400,
      messages: [
        {
          role: "system",
          content: `You are Space Thumb Agent.
Train/generate ONLY from Space competitor titles + thumbs (≥100K).
HEAVILY copy the format reference package: layout zones, subject scale, border, markers, AND text style/placement.
Only replace the discovery subject + punch words for the new title.

TEXT RULES (from real space comps):
- 2-5 blunt ALL-CAPS words max
- Clean thick sans like competitor thumbs (white/yellow fill + hard black outline)
- Real YouTube-composited look — never AI glow/chrome/bubble letters
- Prefer phrases like THIS IS … / WHAT … SAW / NASA'S PLAN / NOTHING

${THUMB_QUALITY_SYSTEM_RULES}

Return STRICT JSON only (no markdown):
{
  "analysis": "why this space format fits + which comp traits you are copying",
  "chosenFormat": "short format name from playbook/comp",
  "overlayText": "2-5 word ALL-CAPS punch line matching real space-comp text style",
  "discoveryPlan": "photoreal space subject for THIS title, matching the reference's scale/lighting language",
  "imagePrompt": "edit instruction: heavily preserve uploaded comp layout+text style; replace subject/words for new title; 16:9; real youtube thumb typography",
  "whyTheseComps": "why this space format reference"
}`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `NEW TITLE: ${title}
${input.notes?.trim() ? `EXTRA: ${input.notes.trim()}` : ""}

SPACE FORMAT REFERENCE (COPY PACKAGE HEAVILY — layout + text style):
${picked.reference.title} | ${picked.reference.viewCount} views
${picked.reference.thumbnailUrl}

COMP BLUEPRINT (layout + text style):
${layoutBlueprint}

SPACE PLAYBOOK:
${playbookBrief.summary}
VIRAL:
${playbookBrief.viral.map((p) => `- ${p}`).join("\n")}
FORMATS:
${playbookBrief.formats.map((p) => `- ${p}`).join("\n")}
DO:
${playbookBrief.doList.map((p) => `- ${p}`).join("\n")}
DON'T:
${playbookBrief.dontList.map((p) => `- ${p}`).join("\n")}

Top space-comp text examples: NOTHING · THIS IS JUPITER · THIS IS PLUTO · WHAT RUSSIA SAW · NASA'S PLAN · WHAT CHINA SAW · THIS ISN'T GOOD · INSIDE STARSHIP

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
  }

  let content = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await requestBrief();
    content = completion.choices[0]?.message?.content?.trim() || "";
    if (content.includes("{")) break;
  }

  let parsed: {
    analysis: string;
    chosenFormat: string;
    overlayText: string;
    discoveryPlan: string;
    imagePrompt: string;
    whyTheseComps: string;
  };
  try {
    parsed = extractJson(content);
  } catch {
    // Hard fallback so jobs still render with strong comp/text guidance
    const words = title
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    const punch = (
      words.slice(0, 4).join(" ").toUpperCase() || "THIS IS SPACE"
    ).slice(0, 42);
    parsed = {
      analysis: "Fallback brief — preserve format-reference package heavily.",
      chosenFormat: playbookBrief.formats[0] || "Cinematic planetary reveal",
      overlayText: punch,
      discoveryPlan: `Photoreal space subject that sells: ${title}`,
      imagePrompt:
        "Heavily preserve uploaded competitor layout, text zone, border, and marker style; replace subject and punch words for the new title; real youtube-space typography.",
      whyTheseComps: `Closest space format reference: ${picked.reference.title}`,
    };
  }

  parsed.overlayText = normalizeSpaceOverlayText(
    parsed.overlayText || "",
    title,
  );

  const imagePrompt = [
    "Using the uploaded Space competitor thumbnail as a HEAVY STYLE + LAYOUT REFERENCE, create a brand-new original 16:9 YouTube thumbnail that still feels like the same channel package.",
    "Preserve composition grammar, subject scale, text zone, border/frame, and marker language from the reference as closely as possible.",
    "Replace only the main discovery subject and the punch words so they sell the new title — do not invent a totally different thumbnail genre.",
    `Sell ONLY this title: ${title}`,
    "Output must be 16:9 (1280x720).",
    parsed.imagePrompt.trim(),
    parsed.overlayText
      ? `On-image text exactly: "${parsed.overlayText}" — render ONLY these words as thick geometric ALL-CAPS sans with hard black outline, white or yellow fill, razor-sharp edges, even spacing; look like a real YouTube space thumb (THIS IS JUPITER / WHAT NASA SAW style). Zero AI glow/chrome/bubble/warp.`
      : "",
    parsed.discoveryPlan
      ? `Discovery subject for this title (keep reference lighting/scale language): ${parsed.discoveryPlan.trim()}`
      : "",
    SPACE_COMP_FIDELITY_LOCK,
    SPACE_COMP_TEXT_LOCK,
    THUMB_RENDER_QUALITY,
  ]
    .filter(Boolean)
    .join(" ");

  const generatePrompt = [
    "Create an original photoreal 16:9 Space YouTube thumbnail (1280x720) heavily inspired by real ≥100K Space competitor packages.",
    `Title: ${title}`,
    parsed.chosenFormat ? `Format: ${parsed.chosenFormat}` : "",
    "Clone the reference package grammar: big subject, sparse black space, short blunt headline, optional border/markers.",
    "Documentary / archival / NASA-footage realism — not generic glossy sci-fi CGI.",
    parsed.overlayText
      ? `Text (exact words, real youtube-comp typography, 2-5 blunt caps, razor sharp): "${parsed.overlayText}"`
      : "",
    parsed.discoveryPlan
      ? `Discovery: ${parsed.discoveryPlan}`
      : "",
    `Comp blueprint: ${layoutBlueprint}`,
    SPACE_COMP_FIDELITY_LOCK,
    SPACE_COMP_TEXT_LOCK,
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
