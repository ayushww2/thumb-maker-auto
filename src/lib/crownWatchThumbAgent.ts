import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/db";
import {
  canFetchReferenceImage,
  createReasoningCompletion,
  generateThumbnailFromReference,
  generateThumbnailImage,
  resolveVisionImageUrl,
} from "@/lib/contactbox";
import { getR2Config, getReasoningModel } from "@/lib/env";
import { toYouTube16x9 } from "@/lib/imageSize";
import { scoreCompetitor } from "@/lib/textSimilarity";
import { THUMB_RENDER_QUALITY } from "@/lib/thumbRenderQuality";

export const CROWN_NICHE = "crown-watch";
export const CROWN_MIN_VIEWS = 1;
export const CROWN_AGENT_ID = "crown-watch-agent";
const SCAN_LIMIT = 16;
const PLAYBOOK_PATH = path.join(process.cwd(), "data", "crown-playbook.json");

export type CrownCompetitor = {
  youtubeId: string;
  title: string;
  viewCount: number;
  thumbnailUrl: string;
  videoUrl: string;
  channelName: string;
  score: number;
  isFormatReference?: boolean;
};

export type CrownPlaybook = {
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
  ctrTexts: string[];
  visualLessons: Array<{
    youtubeId: string;
    title: string;
    viewCount: number;
    overlayText: string;
    formatLabel: string;
    composition: string;
    whyItWorks: string;
  }>;
  r2Url?: string | null;
};

export type CrownAgentResult = {
  agent: string;
  title: string;
  playbook: CrownPlaybook;
  competitors: CrownCompetitor[];
  formatReference: CrownCompetitor & { layoutBlueprint: string };
  analysis: string;
  chosenFormat: string;
  overlayText: string;
  discoveryPlan: string;
  imagePrompt: string;
  generatePrompt: string;
  whyTheseComps: string;
};

const CROWN_TEXT_LOCK = [
  "ROYAL TEXT LOCK (mandatory — match the trained royal CTR package):",
  "Bottom-left: a solid RED rectangle tab that reads exactly BREAKING NEWS in white bold condensed ALL-CAPS.",
  "Immediately to its right and across the bottom: a solid WHITE banner with thick black condensed sans ALL-CAPS.",
  "Banner copy is SHORT (4-8 words), emotional, and usually a quoted outburst or accusation.",
  "Proven high-CTR shapes from this channel's top videos: \"WE HAD TO MAKE THIS HARD DECISION!\" · \"PRINCESS ANNE JUST BROKE DOWN\" · MEGHAN RUINED MY DAMN LIFE! · \"SHE BEEN HIDING THESE FOR YEARS\" · \"CATHERINE GETS THE CROWN!\"",
  "Write a NEW line in that grammar for THIS title. Do not paste the YouTube title onto the banner.",
  "Letters must be razor-sharp, even, upright, high contrast. No glow, chrome, bubble, script, or warped glyphs.",
].join(" ");

const CROWN_LAYOUT_LOCK = [
  "ROYAL LAYOUT LOCK:",
  "Photoreal press / paparazzi stills only — real royal and celebrity faces, not illustrated or CGI.",
  "Prefer a vertical split: shocked or speaking face on the left, the scandal scene on the right. A single tight two-shot is also valid when the reference is a single frame.",
  "Faces are large and recognizable. Optional small inset photo with a thin red frame.",
  "Keep the BREAKING NEWS + white banner glued to the bottom edge. No YouTube UI, no channel watermark, no extra logos.",
].join(" ");

function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let raw = (fenced?.[1] || text).trim();
  raw = raw.replace(/^[^{]*/, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Crown agent returned no JSON object: ${text.slice(0, 240)}`);
  }
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

function normalizeCrownOverlay(raw: string, title: string): string {
  let text = raw.replace(/\s+/g, " ").trim();
  text = text.replace(/^["“”']+|["“”']+$/g, "");
  const words = text
    .replace(/[^a-zA-Z0-9*'!?\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  let line = words.join(" ").toUpperCase();
  if (words.length < 3) {
    const fromTitle = title
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 6)
      .join(" ")
      .toUpperCase();
    line = fromTitle || "SHE JUST BROKE DOWN";
  }
  if (!/[!]$/.test(line) && line.split(" ").length <= 6) line = `${line}!`;
  return `"${line.replace(/!+$/, "!")}"`;
}

async function loadCrownVideos() {
  return prisma.video.findMany({
    where: { niche: CROWN_NICHE },
    include: { channel: true, thumbScan: true },
    orderBy: { viewCount: "desc" },
  });
}

async function loadCachedPlaybook(): Promise<CrownPlaybook | null> {
  try {
    const row = await prisma.agentPlaybook.findUnique({
      where: { id: CROWN_AGENT_ID },
    });
    if (row?.summary) {
      const extra = row.lowViewPatterns as string[] | null;
      return {
        generatedAt: row.generatedAt.toISOString(),
        niche: CROWN_NICHE,
        minViews: CROWN_MIN_VIEWS,
        sampleSize: row.sampleSize,
        viralThreshold: row.viralThreshold,
        scanCount: row.scanCount,
        summary: row.summary,
        viralPatterns: row.viralPatterns as string[],
        thumbnailFormats: row.thumbnailFormats as string[],
        titleFormulas: row.titleFormulas as string[],
        doList: row.doList as string[],
        dontList: row.dontList as string[],
        ctrTexts: Array.isArray(extra) ? extra : [],
        visualLessons: [],
        r2Url: row.r2Url,
      };
    }
  } catch {
    // ignore
  }
  try {
    return JSON.parse(await readFile(PLAYBOOK_PATH, "utf8")) as CrownPlaybook;
  } catch {
    return null;
  }
}

async function persistPlaybook(playbook: CrownPlaybook) {
  await mkdir(path.dirname(PLAYBOOK_PATH), { recursive: true });
  await writeFile(PLAYBOOK_PATH, JSON.stringify(playbook, null, 2));
  await prisma.agentPlaybook.upsert({
    where: { id: CROWN_AGENT_ID },
    create: {
      id: CROWN_AGENT_ID,
      agent: CROWN_AGENT_ID,
      summary: playbook.summary,
      viralPatterns: playbook.viralPatterns,
      lowViewPatterns: playbook.ctrTexts,
      thumbnailFormats: playbook.thumbnailFormats,
      titleFormulas: playbook.titleFormulas,
      doList: playbook.doList,
      dontList: playbook.dontList,
      viralThreshold: playbook.viralThreshold,
      lowThreshold: CROWN_MIN_VIEWS,
      sampleSize: playbook.sampleSize,
      viralCount: playbook.sampleSize,
      lowCount: 0,
      scanCount: playbook.scanCount,
      generatedAt: new Date(playbook.generatedAt),
    },
    update: {
      summary: playbook.summary,
      viralPatterns: playbook.viralPatterns,
      lowViewPatterns: playbook.ctrTexts,
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
  if (!r2.configured) return;
  try {
    const key = "playbooks/crown-watch-agent.json";
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
        Body: JSON.stringify(playbook),
        ContentType: "application/json",
      }),
    );
  } catch (err) {
    console.warn("[crown-agent] playbook upload failed", err);
  }
}

async function scanThumb(input: {
  youtubeId: string;
  title: string;
  viewCount: number;
  thumbnailUrl: string;
  videoDbId: string;
}) {
  const visionUrl = await resolveVisionImageUrl(input.thumbnailUrl);
  const parts: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text: `You are studying a Royal YouTube thumbnail (royal gossip / breaking-news package).
Title: ${input.title}
Views: ${input.viewCount}

Return STRICT JSON only:
{
  "subject": "who is pictured",
  "composition": "split or single, where faces sit",
  "colors": "palette",
  "overlayText": "EXACT on-image banner text including BREAKING NEWS if present",
  "emotionalHook": "why it gets the click",
  "formatLabel": "short format name",
  "whyItWorks": "why this text + layout wins CTR"
}`,
    },
  ];
  if (visionUrl) parts.push({ type: "image_url", image_url: { url: visionUrl } });

  const completion = await createReasoningCompletion({
    temperature: 0.1,
    max_tokens: 700,
    messages: [{ role: "user", content: parts as never }],
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
      tier: input.viewCount >= 200_000 ? "viral" : "mid",
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
      tier: input.viewCount >= 200_000 ? "viral" : "mid",
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
    overlayText: parsed.overlayText || "",
    formatLabel: parsed.formatLabel || "",
    composition: parsed.composition || "",
    whyItWorks: parsed.whyItWorks || "",
  };
}

export async function buildCrownPlaybook(force = false): Promise<CrownPlaybook> {
  if (!force) {
    const cached = await loadCachedPlaybook();
    if (cached?.summary) return cached;
  }

  const videos = await loadCrownVideos();
  if (!videos.length) {
    throw new Error("No Royal videos found. Run crown:seed first.");
  }

  const visualLessons: CrownPlaybook["visualLessons"] = [];
  for (const v of videos.slice(0, SCAN_LIMIT)) {
    try {
      const lesson = await scanThumb({
        youtubeId: v.youtubeId,
        title: v.title,
        viewCount: v.viewCount,
        thumbnailUrl: v.r2ThumbnailUrl || v.thumbnailUrl,
        videoDbId: v.id,
      });
      visualLessons.push(lesson);
      console.log("[crown-agent] scanned", v.youtubeId, lesson.overlayText);
    } catch (err) {
      console.warn(
        "[crown-agent] scan failed",
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
        `${i + 1}. [${l.viewCount}] ${l.title}\nformat=${l.formatLabel}\nlayout=${l.composition}\ntext=${l.overlayText}\nwhy=${l.whyItWorks}`,
    )
    .join("\n\n");

  const completion = await createReasoningCompletion({
    temperature: 0.3,
    max_tokens: 1400,
    messages: [
      {
        role: "system",
        content: `You train the Royal thumbnail model ONLY on this channel’s top royal-gossip videos.
The winning package is: photoreal royal/celebrity split or two-shot, red BREAKING NEWS tab, white banner with a short black ALL-CAPS quote.
Pick banner lines that match the highest-view thumbs, not the long YouTube titles.
Return STRICT JSON only:
{
  "summary": "2-4 sentences",
  "viralPatterns": ["..."],
  "thumbnailFormats": ["..."],
  "titleFormulas": ["..."],
  "ctrTexts": ["8-12 example banner lines in the channel's exact voice, short ALL-CAPS quotes"],
  "doList": ["..."],
  "dontList": ["..."]
}`,
      },
      {
        role: "user",
        content: `Collection: ${videos.length} top Royal videos.

TOP TITLES:
${titleLines}

VISUAL SCANS OF THE HIGHEST-VIEW THUMBS:
${scanLines || "(no scans)"}

Build the playbook JSON now.`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content?.trim() || "";
  const parsed = extractJson<{
    summary: string;
    viralPatterns: string[];
    thumbnailFormats: string[];
    titleFormulas: string[];
    ctrTexts: string[];
    doList: string[];
    dontList: string[];
  }>(content);

  const playbook: CrownPlaybook = {
    generatedAt: new Date().toISOString(),
    niche: CROWN_NICHE,
    minViews: CROWN_MIN_VIEWS,
    sampleSize: videos.length,
    viralThreshold: 100_000,
    scanCount: visualLessons.length,
    summary: parsed.summary,
    viralPatterns: parsed.viralPatterns || [],
    thumbnailFormats: parsed.thumbnailFormats || [],
    titleFormulas: parsed.titleFormulas || [],
    doList: parsed.doList || [],
    dontList: parsed.dontList || [],
    ctrTexts: parsed.ctrTexts || visualLessons.map((l) => l.overlayText).filter(Boolean),
    visualLessons,
  };
  await persistPlaybook(playbook);
  return playbook;
}

export async function pickCrownFormatReference(title: string) {
  const videos = await loadCrownVideos();
  if (!videos.length) throw new Error("No Royal format references in DB");
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
      fitness:
        score * 0.55 +
        Math.min(0.45, Math.log10(v.viewCount + 1) / 12) +
        (v.r2ThumbnailUrl ? 0.08 : 0),
    };
  });
  scored.sort((a, b) => b.fitness - a.fitness || b.viewCount - a.viewCount);

  let reference = { ...scored[0], isFormatReference: true };
  for (const candidate of scored.slice(0, 8)) {
    if (await canFetchReferenceImage(candidate.thumbnailUrl)) {
      reference = { ...candidate, isFormatReference: true };
      break;
    }
  }
  const shortlist = scored.slice(0, 5).map(({ fitness: _f, ...rest }) => rest);
  return { reference, shortlist };
}

async function layoutBlueprint(thumbnailUrl: string) {
  const visionUrl = await resolveVisionImageUrl(thumbnailUrl);
  const fallback = [
    "16:9 Royal package",
    "Large photoreal faces, often a vertical split",
    "Red BREAKING NEWS tab bottom-left",
    "White banner with short black ALL-CAPS quote",
  ].join("\n");
  if (!visionUrl) return fallback;
  try {
    const completion = await createReasoningCompletion({
      temperature: 0.1,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract a tight layout blueprint of this Royal thumbnail: zones, split or single, BREAKING NEWS placement, exact banner text style. Bullets only.",
            },
            { type: "image_url", image_url: { url: visionUrl } },
          ] as never,
        },
      ],
    });
    return completion.choices[0]?.message?.content?.trim() || fallback;
  } catch {
    return fallback;
  }
}

export async function runCrownWatchAgent(input: {
  title: string;
  notes?: string;
}): Promise<CrownAgentResult> {
  const title = input.title.trim();
  if (!title) throw new Error("Title is required");

  const [playbook, picked] = await Promise.all([
    buildCrownPlaybook(false),
    pickCrownFormatReference(title),
  ]);
  const blueprint = await layoutBlueprint(picked.reference.thumbnailUrl);
  const ctrExamples = (playbook.ctrTexts || []).slice(0, 8).join(" · ");

  let content = "";
  try {
    const completion = await createReasoningCompletion({
      temperature: 0.45,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content: `You are the Royal thumb agent.
Copy the trained royal package: photoreal split/two-shot, red BREAKING NEWS tab, white banner, short quoted ALL-CAPS punch line.
The banner is NOT the YouTube title. It is a 4-8 word emotional quote that would win the click.
${CROWN_TEXT_LOCK}
Return STRICT JSON only:
{
  "analysis": "why this format fits",
  "chosenFormat": "split-scandal | two-shot announcement | inset reaction",
  "overlayText": "short ALL-CAPS banner quote in quotes",
  "discoveryPlan": "who is on the left, who/what is on the right, photoreal",
  "imagePrompt": "edit instruction preserving BREAKING NEWS + white banner",
  "whyTheseComps": "why this reference"
}`,
        },
        {
          role: "user",
          content: `NEW TITLE: ${title}
${input.notes?.trim() ? `EXTRA: ${input.notes.trim()}` : ""}

FORMAT REFERENCE (${picked.reference.viewCount} views): ${picked.reference.title}

BLUEPRINT:
${blueprint}

PLAYBOOK: ${playbook.summary}
CTR LINES THAT WON: ${ctrExamples || "WE HAD TO MAKE THIS HARD DECISION · PRINCESS ANNE JUST BROKE DOWN · CATHERINE GETS THE CROWN"}

Produce JSON now.`,
        },
      ],
    });
    content = completion.choices[0]?.message?.content?.trim() || "";
  } catch (err) {
    console.warn("[crown-agent] brief failed", err);
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
    parsed = {
      analysis: "Fallback — keep the Royal breaking-news package.",
      chosenFormat: "split-scandal",
      overlayText: "SHE JUST BROKE DOWN",
      discoveryPlan: `Photoreal press stills of the people named in: ${title}`,
      imagePrompt:
        "Keep the red BREAKING NEWS tab and white quote banner; replace the people and the quote for the new title.",
      whyTheseComps: picked.reference.title,
    };
  }
  parsed.overlayText = normalizeCrownOverlay(parsed.overlayText || "", title);

  const imagePrompt = [
    "Using the uploaded Royal thumbnail as the LAYOUT REFERENCE, make a new 16:9 YouTube thumbnail in the exact same package.",
    CROWN_LAYOUT_LOCK,
    CROWN_TEXT_LOCK,
    `Sell ONLY this title: ${title}`,
    `Banner text exactly: ${parsed.overlayText}`,
    "Also render a red tab that says BREAKING NEWS in white.",
    parsed.discoveryPlan,
    parsed.imagePrompt,
    blueprint,
    THUMB_RENDER_QUALITY,
    "Output 16:9 1280x720. No watermark. No YouTube UI.",
  ]
    .filter(Boolean)
    .join(" ");

  const generatePrompt = [
    "Photoreal 16:9 Royal YouTube thumbnail.",
    CROWN_LAYOUT_LOCK,
    CROWN_TEXT_LOCK,
    `Title to sell: ${title}`,
    `Banner text exactly: ${parsed.overlayText}`,
    "Red BREAKING NEWS tab, bottom left, white bold caps.",
    parsed.discoveryPlan,
    THUMB_RENDER_QUALITY,
  ].join(" ");

  return {
    agent: CROWN_AGENT_ID,
    title,
    playbook,
    competitors: picked.shortlist,
    formatReference: { ...picked.reference, layoutBlueprint: blueprint },
    analysis: parsed.analysis,
    chosenFormat: parsed.chosenFormat,
    overlayText: parsed.overlayText,
    discoveryPlan: parsed.discoveryPlan,
    imagePrompt,
    generatePrompt,
    whyTheseComps: parsed.whyTheseComps,
  };
}

export async function generateWithCrownAgent(input: {
  title: string;
  notes?: string;
}) {
  const brief = await runCrownWatchAgent(input);
  let image: Buffer | null = null;
  let usedRef = brief.formatReference;
  const refs = [
    brief.formatReference,
    ...brief.competitors.filter((c) => c.youtubeId !== brief.formatReference.youtubeId),
  ].slice(0, 3);

  for (const ref of refs) {
    try {
      image = await generateThumbnailFromReference({
        prompt: brief.imagePrompt,
        referenceImageUrl: ref.thumbnailUrl,
      });
      usedRef = { ...brief.formatReference, ...ref, layoutBlueprint: brief.formatReference.layoutBlueprint };
      break;
    } catch (err) {
      console.warn("[crown-agent] edit failed", ref.youtubeId, err);
    }
  }
  if (!image) image = await generateThumbnailImage(brief.generatePrompt);
  image = await toYouTube16x9(image);
  return {
    brief: { ...brief, formatReference: usedRef },
    image,
  };
}

export async function getCrownAgentStatus() {
  const [playbookRow, videoCount, scanCount] = await Promise.all([
    prisma.agentPlaybook.findUnique({ where: { id: CROWN_AGENT_ID } }),
    prisma.video.count({ where: { niche: CROWN_NICHE } }),
    prisma.thumbScan.count({ where: { video: { niche: CROWN_NICHE } } }),
  ]);
  return {
    agent: CROWN_AGENT_ID,
    niche: CROWN_NICHE,
    trained: Boolean(playbookRow?.summary),
    videoCount,
    scanCount,
    playbook: playbookRow
      ? {
          summary: playbookRow.summary,
          sampleSize: playbookRow.sampleSize,
          scanCount: playbookRow.scanCount,
          thumbnailFormats: playbookRow.thumbnailFormats,
          titleFormulas: playbookRow.titleFormulas,
          ctrTexts: playbookRow.lowViewPatterns,
        }
      : null,
  };
}
