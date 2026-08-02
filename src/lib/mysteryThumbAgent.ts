import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/db";
import { createContactBoxClient, generateThumbnailImage } from "@/lib/contactbox";
import { getR2Config, getReasoningModel } from "@/lib/env";
import { scoreCompetitor } from "@/lib/textSimilarity";

export type CompetitorRef = {
  youtubeId: string;
  title: string;
  viewCount: number;
  thumbnailUrl: string;
  videoUrl: string;
  channelName: string;
  score: number;
};

export type ThumbScanLesson = {
  youtubeId: string;
  title: string;
  viewCount: number;
  tier: "viral" | "low";
  subject: string;
  composition: string;
  colors: string;
  overlayText: string;
  emotionalHook: string;
  formatLabel: string;
  whyItWorks: string;
  thumbnailUrl: string;
};

export type MysteryPlaybook = {
  generatedAt: string;
  sampleSize: number;
  viralThreshold: number;
  lowThreshold: number;
  viralCount: number;
  lowCount: number;
  scanCount: number;
  summary: string;
  viralPatterns: string[];
  lowViewPatterns: string[];
  thumbnailFormats: string[];
  titleFormulas: string[];
  doList: string[];
  dontList: string[];
  visualLessons: ThumbScanLesson[];
  r2Url?: string | null;
};

export type MysteryAgentResult = {
  agent: "mystery-thumb-agent";
  title: string;
  playbook: MysteryPlaybook;
  competitors: CompetitorRef[];
  analysis: string;
  chosenFormat: string;
  overlayText: string;
  imagePrompt: string;
  whyTheseComps: string;
};

const PLAYBOOK_PATH = path.join(process.cwd(), "data", "mystery-playbook.json");
const VIRAL_VIEWS = 500_000;
const LOW_VIEWS = 80_000;
const SCAN_PER_TIER = 12;

function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] || text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Agent returned no JSON object");
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

async function loadCachedPlaybook(): Promise<MysteryPlaybook | null> {
  try {
    const fromDb = await prisma.agentPlaybook.findUnique({
      where: { id: "mystery-thumb-agent" },
    });
    if (fromDb?.summary) {
      return {
        generatedAt: fromDb.generatedAt.toISOString(),
        sampleSize: fromDb.sampleSize,
        viralThreshold: fromDb.viralThreshold,
        lowThreshold: fromDb.lowThreshold,
        viralCount: fromDb.viralCount,
        lowCount: fromDb.lowCount,
        scanCount: fromDb.scanCount,
        summary: fromDb.summary,
        viralPatterns: fromDb.viralPatterns as string[],
        lowViewPatterns: fromDb.lowViewPatterns as string[],
        thumbnailFormats: fromDb.thumbnailFormats as string[],
        titleFormulas: fromDb.titleFormulas as string[],
        doList: fromDb.doList as string[],
        dontList: fromDb.dontList as string[],
        visualLessons: [],
        r2Url: fromDb.r2Url,
      };
    }
  } catch {
    // DB table may not exist yet during first boot
  }
  try {
    const raw = await readFile(PLAYBOOK_PATH, "utf8");
    return JSON.parse(raw) as MysteryPlaybook;
  } catch {
    return null;
  }
}

async function savePlaybookLocal(playbook: MysteryPlaybook) {
  await mkdir(path.dirname(PLAYBOOK_PATH), { recursive: true });
  await writeFile(PLAYBOOK_PATH, JSON.stringify(playbook, null, 2));
}

async function persistPlaybook(playbook: MysteryPlaybook) {
  await savePlaybookLocal(playbook);

  await prisma.agentPlaybook.upsert({
    where: { id: "mystery-thumb-agent" },
    create: {
      id: "mystery-thumb-agent",
      agent: "mystery-thumb-agent",
      summary: playbook.summary,
      viralPatterns: playbook.viralPatterns,
      lowViewPatterns: playbook.lowViewPatterns,
      thumbnailFormats: playbook.thumbnailFormats,
      titleFormulas: playbook.titleFormulas,
      doList: playbook.doList,
      dontList: playbook.dontList,
      viralThreshold: playbook.viralThreshold,
      lowThreshold: playbook.lowThreshold,
      sampleSize: playbook.sampleSize,
      viralCount: playbook.viralCount,
      lowCount: playbook.lowCount,
      scanCount: playbook.scanCount,
      r2Url: playbook.r2Url || null,
      generatedAt: new Date(playbook.generatedAt),
    },
    update: {
      summary: playbook.summary,
      viralPatterns: playbook.viralPatterns,
      lowViewPatterns: playbook.lowViewPatterns,
      thumbnailFormats: playbook.thumbnailFormats,
      titleFormulas: playbook.titleFormulas,
      doList: playbook.doList,
      dontList: playbook.dontList,
      viralThreshold: playbook.viralThreshold,
      lowThreshold: playbook.lowThreshold,
      sampleSize: playbook.sampleSize,
      viralCount: playbook.viralCount,
      lowCount: playbook.lowCount,
      scanCount: playbook.scanCount,
      r2Url: playbook.r2Url || null,
      generatedAt: new Date(playbook.generatedAt),
    },
  });

  const r2 = getR2Config();
  if (r2.configured) {
    const key = "collection/mystery-playbook.json";
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
        CacheControl: "public, max-age=300",
      }),
    );
    playbook.r2Url = `${r2.publicBaseUrl}/${key}`;
    await prisma.agentPlaybook.update({
      where: { id: "mystery-thumb-agent" },
      data: { r2Key: key, r2Url: playbook.r2Url },
    });
    await savePlaybookLocal(playbook);
  }
}

export async function findClosestCompetitors(
  title: string,
  limit = 5,
): Promise<CompetitorRef[]> {
  const videos = await prisma.video.findMany({
    include: { channel: true },
  });

  const ranked = videos
    .map((v) => {
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
      };
    })
    .filter((v) => v.score > 0.05)
    .sort((a, b) => b.score - a.score || b.viewCount - a.viewCount)
    .slice(0, limit);

  if (ranked.length < limit) {
    const top = [...videos]
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, limit - ranked.length)
      .map((v) => ({
        youtubeId: v.youtubeId,
        title: v.title,
        viewCount: v.viewCount,
        thumbnailUrl: v.r2ThumbnailUrl || v.thumbnailUrl,
        videoUrl: v.videoUrl,
        channelName: v.channel.name,
        score: 0.04,
      }));
    const seen = new Set(ranked.map((r) => r.youtubeId));
    for (const t of top) {
      if (!seen.has(t.youtubeId)) ranked.push(t);
    }
  }

  return ranked.slice(0, limit);
}

async function scanOneThumb(input: {
  youtubeId: string;
  title: string;
  viewCount: number;
  thumbnailUrl: string;
  videoDbId: string;
  tier: "viral" | "low";
}): Promise<ThumbScanLesson | null> {
  const client = createContactBoxClient();
  const model = getReasoningModel();

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are Mystery Thumb Agent studying a competitor YouTube thumbnail.
Title: ${input.title}
Views: ${input.viewCount}
Tier: ${input.tier}

Return STRICT JSON only:
{
  "subject": "main subject(s)",
  "composition": "layout / left-right-center / scale",
  "colors": "color grade + contrast",
  "overlayText": "exact on-image text or empty",
  "emotionalHook": "curiosity/fear/awe hook",
  "formatLabel": "short format name e.g. face+threat / sealed-chamber / AI-reveal",
  "whyItWorks": "1-2 sentences on why this package works or fails for views"
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

    const lesson: ThumbScanLesson = {
      youtubeId: input.youtubeId,
      title: input.title,
      viewCount: input.viewCount,
      tier: input.tier,
      subject: parsed.subject || "",
      composition: parsed.composition || "",
      colors: parsed.colors || "",
      overlayText: parsed.overlayText || "",
      emotionalHook: parsed.emotionalHook || "",
      formatLabel: parsed.formatLabel || "",
      whyItWorks: parsed.whyItWorks || "",
      thumbnailUrl: input.thumbnailUrl,
    };

    await prisma.thumbScan.upsert({
      where: { videoId: input.videoDbId },
      create: {
        videoId: input.videoDbId,
        tier: input.tier,
        subject: lesson.subject,
        composition: lesson.composition,
        colors: lesson.colors,
        overlayText: lesson.overlayText,
        emotionalHook: lesson.emotionalHook,
        formatLabel: lesson.formatLabel,
        whyItWorks: lesson.whyItWorks,
        rawNotes: content,
        model,
      },
      update: {
        tier: input.tier,
        subject: lesson.subject,
        composition: lesson.composition,
        colors: lesson.colors,
        overlayText: lesson.overlayText,
        emotionalHook: lesson.emotionalHook,
        formatLabel: lesson.formatLabel,
        whyItWorks: lesson.whyItWorks,
        rawNotes: content,
        model,
      },
    });

    return lesson;
  } catch (err) {
    console.warn(
      `[mystery-thumb-agent] scan failed ${input.youtubeId}`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function scanTrainingThumbs(): Promise<ThumbScanLesson[]> {
  const [viral, low] = await Promise.all([
    prisma.video.findMany({
      where: { viewCount: { gte: VIRAL_VIEWS }, r2ThumbnailUrl: { not: null } },
      orderBy: { viewCount: "desc" },
      take: SCAN_PER_TIER,
    }),
    prisma.video.findMany({
      where: { viewCount: { lte: LOW_VIEWS }, r2ThumbnailUrl: { not: null } },
      orderBy: { viewCount: "asc" },
      take: SCAN_PER_TIER,
    }),
  ]);

  const lessons: ThumbScanLesson[] = [];
  const queue = [
    ...viral.map((v) => ({ v, tier: "viral" as const })),
    ...low.map((v) => ({ v, tier: "low" as const })),
  ];

  // sequential-ish with small concurrency to avoid rate limits
  const concurrency = 3;
  let idx = 0;
  async function worker() {
    while (idx < queue.length) {
      const i = idx++;
      const item = queue[i];
      const lesson = await scanOneThumb({
        youtubeId: item.v.youtubeId,
        title: item.v.title,
        viewCount: item.v.viewCount,
        thumbnailUrl: item.v.r2ThumbnailUrl || item.v.thumbnailUrl,
        videoDbId: item.v.id,
        tier: item.tier,
      });
      if (lesson) lessons.push(lesson);
      console.log(
        `[mystery-thumb-agent] scanned ${lessons.length}/${queue.length} (${item.tier}) ${item.v.youtubeId}`,
      );
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return lessons;
}

export async function buildMysteryPlaybook(force = false): Promise<MysteryPlaybook> {
  if (!force) {
    const cached = await loadCachedPlaybook();
    if (cached?.summary) return cached;
  }

  const [viral, low, total, visualLessons] = await Promise.all([
    prisma.video.findMany({
      where: { viewCount: { gte: VIRAL_VIEWS } },
      orderBy: { viewCount: "desc" },
      take: 40,
      include: { channel: true },
    }),
    prisma.video.findMany({
      where: { viewCount: { lte: LOW_VIEWS } },
      orderBy: { viewCount: "asc" },
      take: 40,
      include: { channel: true },
    }),
    prisma.video.count(),
    scanTrainingThumbs(),
  ]);

  const client = createContactBoxClient();
  const model = getReasoningModel();

  const viralLines = viral
    .map(
      (v, i) =>
        `${i + 1}. [${(v.viewCount / 1_000_000).toFixed(2)}M] ${v.title} | thumb=${v.r2ThumbnailUrl || v.thumbnailUrl}`,
    )
    .join("\n");
  const lowLines = low
    .map(
      (v, i) =>
        `${i + 1}. [${Math.round(v.viewCount / 1000)}K] ${v.title} | thumb=${v.r2ThumbnailUrl || v.thumbnailUrl}`,
    )
    .join("\n");

  const scanLines = visualLessons
    .map(
      (l, i) =>
        `${i + 1}. [${l.tier}/${l.viewCount}] ${l.title}
format=${l.formatLabel}
subject=${l.subject}
composition=${l.composition}
colors=${l.colors}
text="${l.overlayText}"
hook=${l.emotionalHook}
lesson=${l.whyItWorks}`,
    )
    .join("\n\n");

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.35,
    messages: [
      {
        role: "system",
        content: `You are Mystery Thumb Agent — a YouTube mystery/documentary thumbnail strategist.
You have studied titles, view counts, AND actual thumbnail vision scans.
Return STRICT JSON only:
{
  "summary": "2-4 sentences on what makes these thumbs/titles win vs lose",
  "viralPatterns": ["..."],
  "lowViewPatterns": ["..."],
  "thumbnailFormats": ["composition/format patterns observed in scans"],
  "titleFormulas": ["title formula patterns"],
  "doList": ["actionable rules for making viral mystery thumbs"],
  "dontList": ["what weak/low-view thumbs do"]
}
Focus on mystery niche: Florida invasives, ancient discoveries, AI reveals, sealed chambers, horror-curiosity.
Ground thumbnailFormats in the VISUAL SCAN NOTES (real composition/text/color), not guesses.`,
      },
      {
        role: "user",
        content: `Collection size: ${total} videos (40K+ views indexed).

Viral title examples (>= ${VIRAL_VIEWS} views):
${viralLines}

Lower-performing examples (<= ${LOW_VIEWS} views):
${lowLines}

VISUAL SCAN NOTES (agent looked at the actual thumbnails):
${scanLines || "(no scans)"}

Build the Mystery Thumb Agent playbook JSON now.`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content?.trim() || "";
  const parsed = extractJson<{
    summary: string;
    viralPatterns: string[];
    lowViewPatterns: string[];
    thumbnailFormats: string[];
    titleFormulas: string[];
    doList: string[];
    dontList: string[];
  }>(content);

  const playbook: MysteryPlaybook = {
    generatedAt: new Date().toISOString(),
    sampleSize: total,
    viralThreshold: VIRAL_VIEWS,
    lowThreshold: LOW_VIEWS,
    viralCount: viral.length,
    lowCount: low.length,
    scanCount: visualLessons.length,
    summary: parsed.summary,
    viralPatterns: parsed.viralPatterns || [],
    lowViewPatterns: parsed.lowViewPatterns || [],
    thumbnailFormats: parsed.thumbnailFormats || [],
    titleFormulas: parsed.titleFormulas || [],
    doList: parsed.doList || [],
    dontList: parsed.dontList || [],
    visualLessons,
  };

  await persistPlaybook(playbook);
  return playbook;
}

async function describeCompetitorThumbs(comps: CompetitorRef[]): Promise<string> {
  try {
    const client = createContactBoxClient();
    const model = getReasoningModel();
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [
      {
        type: "text",
        text: `You are Mystery Thumb Agent. For each competitor thumbnail, describe in 1-2 bullets:
subject, composition (left/right/center), color grade, any on-image text, emotional hook.
Then note shared formats across the set. Be concrete.`,
      },
    ];
    for (const [i, c] of comps.entries()) {
      content.push({
        type: "text",
        text: `\n#${i + 1} ${c.viewCount.toLocaleString()} views — ${c.title}`,
      });
      content.push({
        type: "image_url",
        image_url: { url: c.thumbnailUrl },
      });
    }

    const completion = await client.chat.completions.create({
      model,
      temperature: 0.3,
      max_tokens: 900,
      messages: [{ role: "user", content: content as never }],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (text && text.length > 40) return text;
  } catch (err) {
    console.warn(
      "[mystery-thumb-agent] vision describe failed, using titles only",
      err instanceof Error ? err.message : err,
    );
  }

  // Fall back to stored scans when available
  const ids = comps.map((c) => c.youtubeId);
  const stored = await prisma.thumbScan.findMany({
    where: { video: { youtubeId: { in: ids } } },
    include: { video: true },
  });
  if (stored.length) {
    return stored
      .map(
        (s) =>
          `# ${s.video.title} (${s.video.viewCount})\nformat=${s.formatLabel}\nsubject=${s.subject}\ncomposition=${s.composition}\ntext=${s.overlayText}\nlesson=${s.whyItWorks}`,
      )
      .join("\n\n");
  }

  return comps
    .map(
      (c, i) =>
        `#${i + 1} (${c.viewCount.toLocaleString()} views) ${c.title}\nthumb: ${c.thumbnailUrl}`,
    )
    .join("\n\n");
}

export async function runMysteryThumbAgent(input: {
  title: string;
  notes?: string;
}): Promise<MysteryAgentResult> {
  const title = input.title.trim();
  if (!title) throw new Error("Title is required");

  const [playbook, competitors] = await Promise.all([
    buildMysteryPlaybook(false),
    findClosestCompetitors(title, 5),
  ]);

  const visualNotes = await describeCompetitorThumbs(competitors);
  const client = createContactBoxClient();
  const model = getReasoningModel();

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.55,
    messages: [
      {
        role: "system",
        content: `You are Mystery Thumb Agent.
Mission: turn a new video title into a competitor-grade mystery YouTube thumbnail brief.
You trained on a scanned database of viral vs low-view titles/thumbnails.
Use the playbook + closest competitor thumbs to choose format and any on-image text.
Return STRICT JSON only:
{
  "analysis": "what the closest comps teach for THIS title",
  "chosenFormat": "short description of composition format to copy/adapt",
  "overlayText": "0-5 words max that may appear IN the thumbnail (or empty string if none)",
  "imagePrompt": "one detailed 16:9 image generation prompt for gpt-image-2 — photoreal/high-polish mystery documentary still, high contrast, clear focal subject, NO watermarks/UI/logos, match competitor energy; if overlayText is set, include those exact words as bold short thumbnail text",
  "whyTheseComps": "1-2 sentences on why these 5 comps were used"
}
Rules:
- Mimic winning mystery formats from the playbook scans
- Prefer strong single subject + dramatic environment
- Overlay text only if comps commonly use short punchy words; otherwise ""
- imagePrompt must be self-contained for an image model`,
      },
      {
        role: "user",
        content: `NEW TITLE: ${title}
${input.notes?.trim() ? `EXTRA DIRECTION: ${input.notes.trim()}` : ""}

PLAYBOOK SUMMARY:
${playbook.summary}

VIRAL PATTERNS:
${playbook.viralPatterns.map((p) => `- ${p}`).join("\n")}

LOW-VIEW PATTERNS TO AVOID:
${playbook.lowViewPatterns.map((p) => `- ${p}`).join("\n")}

THUMBNAIL FORMATS (from visual scans):
${playbook.thumbnailFormats.map((p) => `- ${p}`).join("\n")}

DO:
${playbook.doList.map((p) => `- ${p}`).join("\n")}

DON'T:
${playbook.dontList.map((p) => `- ${p}`).join("\n")}

TOP 5 CLOSEST COMPETITORS (live vision / stored scans):
${visualNotes}

Produce the JSON brief now.`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content?.trim() || "";
  const parsed = extractJson<{
    analysis: string;
    chosenFormat: string;
    overlayText: string;
    imagePrompt: string;
    whyTheseComps: string;
  }>(content);

  if (!parsed.imagePrompt?.trim()) {
    throw new Error("Mystery Thumb Agent returned an empty imagePrompt");
  }

  return {
    agent: "mystery-thumb-agent",
    title,
    playbook,
    competitors,
    analysis: parsed.analysis,
    chosenFormat: parsed.chosenFormat,
    overlayText: parsed.overlayText || "",
    imagePrompt: parsed.imagePrompt.trim(),
    whyTheseComps: parsed.whyTheseComps,
  };
}

export async function generateWithMysteryAgent(input: {
  title: string;
  notes?: string;
}) {
  const brief = await runMysteryThumbAgent(input);
  const image = await generateThumbnailImage(brief.imagePrompt);
  return { brief, image };
}

export async function getAgentStatus() {
  const [playbookRow, scanCount, videoCount] = await Promise.all([
    prisma.agentPlaybook.findUnique({ where: { id: "mystery-thumb-agent" } }),
    prisma.thumbScan.count(),
    prisma.video.count(),
  ]);
  const filePlaybook = playbookRow ? null : await loadCachedPlaybook();
  return {
    agent: "mystery-thumb-agent",
    trained: Boolean(playbookRow || filePlaybook?.summary),
    videoCount,
    scanCount,
    playbook: playbookRow
      ? {
          summary: playbookRow.summary,
          generatedAt: playbookRow.generatedAt,
          sampleSize: playbookRow.sampleSize,
          viralCount: playbookRow.viralCount,
          lowCount: playbookRow.lowCount,
          scanCount: playbookRow.scanCount,
          r2Url: playbookRow.r2Url,
          viralPatterns: playbookRow.viralPatterns,
          thumbnailFormats: playbookRow.thumbnailFormats,
        }
      : filePlaybook,
  };
}
