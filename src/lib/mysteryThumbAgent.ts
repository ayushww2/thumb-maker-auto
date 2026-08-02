import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/db";
import {
  createContactBoxClient,
  generateThumbnailFromReference,
  generateThumbnailImage,
} from "@/lib/contactbox";
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
  formatScore?: number;
  formatLabel?: string | null;
  isFormatReference?: boolean;
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

export type FormatReference = {
  youtubeId: string;
  title: string;
  viewCount: number;
  thumbnailUrl: string;
  videoUrl: string;
  channelName: string;
  score: number;
  formatLabel: string;
  layoutBlueprint: string;
};

export type MysteryAgentResult = {
  agent: "mystery-thumb-agent";
  title: string;
  playbook: MysteryPlaybook;
  competitors: CompetitorRef[];
  formatReference: FormatReference;
  analysis: string;
  chosenFormat: string;
  overlayText: string;
  discoveryPlan: string;
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

function newsFormatFitness(parts: {
  title?: string | null;
  formatLabel?: string | null;
  overlayText?: string | null;
  composition?: string | null;
  subject?: string | null;
  rawNotes?: string | null;
}): number {
  const blob = [
    parts.title,
    parts.formatLabel,
    parts.overlayText,
    parts.composition,
    parts.subject,
    parts.rawNotes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let score = 0;
  if (/breaking|news|anchor|broadcast|reporter|ticker|cnn|fox|msnbc|bbc/.test(blob))
    score += 0.4;
  if (/face|reaction|shocked|hand over|anchor/.test(blob)) score += 0.2;
  if (/banner|text|caption|headline|breaking/.test(blob) || (parts.overlayText || "").trim())
    score += 0.2;
  if (/arrow|circle|callout/.test(blob)) score += 0.15;
  if (/split|left|right/.test(blob)) score += 0.1;
  return Math.min(1, score);
}

export async function findClosestCompetitors(
  title: string,
  limit = 5,
): Promise<CompetitorRef[]> {
  const videos = await prisma.video.findMany({
    include: { channel: true, thumbScan: true },
  });

  const ranked = videos
    .map((v) => {
      const score = scoreCompetitor({
        query: title,
        title: v.title,
        viewCount: v.viewCount,
      });
      const formatScore = newsFormatFitness({
        title: v.title,
        formatLabel: v.thumbScan?.formatLabel,
        overlayText: v.thumbScan?.overlayText,
        composition: v.thumbScan?.composition,
        subject: v.thumbScan?.subject,
        rawNotes: v.thumbScan?.rawNotes,
      });
      return {
        youtubeId: v.youtubeId,
        title: v.title,
        viewCount: v.viewCount,
        thumbnailUrl: v.r2ThumbnailUrl || v.thumbnailUrl,
        videoUrl: v.videoUrl,
        channelName: v.channel.name,
        score,
        formatScore,
        formatLabel: v.thumbScan?.formatLabel || null,
      };
    })
    .filter((v) => v.score > 0.04)
    .sort((a, b) => b.score - a.score || b.viewCount - a.viewCount)
    .slice(0, Math.max(limit, 12));

  if (ranked.length < limit) {
    const top = [...videos]
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, limit)
      .map((v) => ({
        youtubeId: v.youtubeId,
        title: v.title,
        viewCount: v.viewCount,
        thumbnailUrl: v.r2ThumbnailUrl || v.thumbnailUrl,
        videoUrl: v.videoUrl,
        channelName: v.channel.name,
        score: 0.04,
        formatScore: newsFormatFitness({
          title: v.title,
          formatLabel: v.thumbScan?.formatLabel,
          overlayText: v.thumbScan?.overlayText,
          composition: v.thumbScan?.composition,
          subject: v.thumbScan?.subject,
          rawNotes: v.thumbScan?.rawNotes,
        }),
        formatLabel: v.thumbScan?.formatLabel || null,
      }));
    const seen = new Set(ranked.map((r) => r.youtubeId));
    for (const t of top) {
      if (!seen.has(t.youtubeId)) ranked.push(t);
    }
  }

  return ranked.slice(0, limit);
}

/**
 * Scan the whole collection DB and pick THE ONE thumbnail whose FORMAT
 * we will copy via images/edits (news/breaking/anchor/text package).
 * Title similarity is secondary — layout fitness wins.
 */
export async function pickFormatReference(
  title: string,
): Promise<{ reference: CompetitorRef; shortlist: CompetitorRef[] }> {
  const videos = await prisma.video.findMany({
    include: { channel: true, thumbScan: true },
  });
  if (!videos.length) {
    throw new Error("No competitor thumbnails found to copy format from");
  }

  const scored = videos
    .map((v) => {
      const titleScore = scoreCompetitor({
        query: title,
        title: v.title,
        viewCount: v.viewCount,
      });
      const formatScore = newsFormatFitness({
        title: v.title,
        formatLabel: v.thumbScan?.formatLabel,
        overlayText: v.thumbScan?.overlayText,
        composition: v.thumbScan?.composition,
        subject: v.thumbScan?.subject,
        rawNotes: v.thumbScan?.rawNotes,
      });
      const fitness =
        formatScore * 0.7 +
        titleScore * 0.15 +
        Math.min(0.15, Math.log10(v.viewCount + 1) / 45);
      return {
        youtubeId: v.youtubeId,
        title: v.title,
        viewCount: v.viewCount,
        thumbnailUrl: v.r2ThumbnailUrl || v.thumbnailUrl,
        videoUrl: v.videoUrl,
        channelName: v.channel.name,
        score: titleScore,
        formatScore,
        formatLabel: v.thumbScan?.formatLabel || null,
        fitness,
      };
    })
    .sort((a, b) => b.fitness - a.fitness || b.viewCount - a.viewCount);

  const best = scored[0];
  if (!best?.thumbnailUrl) {
    throw new Error("No format-reference thumbnail URL found in collection DB");
  }

  const reference: CompetitorRef = {
    youtubeId: best.youtubeId,
    title: best.title,
    viewCount: best.viewCount,
    thumbnailUrl: best.thumbnailUrl,
    videoUrl: best.videoUrl,
    channelName: best.channelName,
    score: best.score,
    formatScore: best.formatScore,
    formatLabel: best.formatLabel,
    isFormatReference: true,
  };

  // Keep a small related shortlist for the jobs UI (format ref first)
  const related = await findClosestCompetitors(title, 4);
  const shortlist = [
    reference,
    ...related.filter((r) => r.youtubeId !== reference.youtubeId),
  ].slice(0, 5);

  return { reference, shortlist };
}

async function extractLayoutBlueprint(
  reference: CompetitorRef,
): Promise<string> {
  const client = createContactBoxClient();
  const model = getReasoningModel();
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.1,
    max_tokens: 700,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `This image is the FORMAT REFERENCE for a 16:9 YouTube mystery thumbnail.
Extract a precise LAYOUT BLUEPRINT to copy EXACTLY (positions/zones only — not the discovery content):
- aspect (must be 16:9)
- left/right/top/bottom zones with approximate %
- where the news anchor / reaction face sits
- where breaking-news badge / ticker / banner text sit (quote exact text styles)
- where red arrow + circle sit and how thick they look
- color blocks used for realism (blue banner, red accents, etc.)
Return a tight bullet blueprint, no intro.`,
          },
          { type: "image_url", image_url: { url: reference.thumbnailUrl } },
        ] as never,
      },
    ],
  });
  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("Failed to extract layout blueprint from format reference");
  return text;
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

  const [playbook, picked] = await Promise.all([
    buildMysteryPlaybook(false),
    pickFormatReference(title),
  ]);

  const { reference, shortlist } = picked;
  const layoutBlueprint = await extractLayoutBlueprint(reference);
  const competitors = shortlist.map((c) =>
    c.youtubeId === reference.youtubeId ? { ...c, isFormatReference: true } : c,
  );

  const client = createContactBoxClient();
  const model = getReasoningModel();

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.45,
    messages: [
      {
        role: "system",
        content: `You are Mystery Thumb Agent.
You will EDIT a real competitor thumbnail used as FORMAT REFERENCE.
Goal: keep that reference's 16:9 LAYOUT (anchor/news graphics/text zones/arrow/circle placement) and replace ONLY the discovery content for the new title using playbook learning about what makes clickbait feel real.

Return STRICT JSON only:
{
  "analysis": "why this 1 format reference fits + what content to show for clickbait realism",
  "chosenFormat": "short name of the copied format",
  "overlayText": "3-6 word ALL-CAPS punch line for the banner (required)",
  "discoveryPlan": "concrete photoreal discovery-side content for THIS title (what object/scene/clue/lighting)",
  "imagePrompt": "EDIT INSTRUCTION for gpt-image-2 images/edits. Must start with: Keep the EXACT same 16:9 layout/composition/graphic style as the attached reference image. Then say what to replace on the discovery side, what banner text to set (exact overlayText), keep thick red arrow+circle style, keep news-anchor/breaking zones if present. Explicitly say output must stay 16:9 widescreen (1536x1024).",
  "whyTheseComps": "1 sentence on why this format reference was chosen"
}
Rules:
- COPY FORMAT from the reference — do not invent a new layout
- Orientation MUST stay 16:9 widescreen
- Discovery content must be photoreal and specific to the new title (learned clickbait realism)
- Keep thick red arrow/circle energy if the reference has callouts
- Banner text required; news/breaking realism preferred`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `NEW TITLE: ${title}
${input.notes?.trim() ? `EXTRA DIRECTION: ${input.notes.trim()}` : ""}

FORMAT REFERENCE (COPY THIS LAYOUT EXACTLY):
${reference.title}
views=${reference.viewCount} format=${reference.formatLabel || "n/a"}
url=${reference.thumbnailUrl}

LAYOUT BLUEPRINT EXTRACTED FROM REFERENCE:
${layoutBlueprint}

PLAYBOOK LEARNING (what to show for viral clickbait realism):
SUMMARY: ${playbook.summary}
VIRAL PATTERNS:
${playbook.viralPatterns.map((p) => `- ${p}`).join("\n")}
DO:
${playbook.doList.map((p) => `- ${p}`).join("\n")}
DON'T:
${playbook.dontList.map((p) => `- ${p}`).join("\n")}

Produce the JSON edit brief now.`,
          },
          {
            type: "image_url",
            image_url: { url: reference.thumbnailUrl },
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

  if (!parsed.imagePrompt?.trim()) {
    throw new Error("Mystery Thumb Agent returned an empty imagePrompt");
  }

  // Hard-enforce edit + 16:9 language in the edits prompt
  const imagePrompt = [
    "Keep the EXACT same 16:9 widescreen layout, graphic style, text zones, and clickbait chrome as the attached reference image.",
    "Do not change orientation — output must be 16:9 (1536x1024).",
    parsed.imagePrompt.trim(),
    parsed.overlayText
      ? `Banner / punch text must read exactly: ${parsed.overlayText.trim()}`
      : "",
    parsed.discoveryPlan
      ? `Discovery-side content to depict: ${parsed.discoveryPlan.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    agent: "mystery-thumb-agent",
    title,
    playbook,
    competitors,
    formatReference: {
      youtubeId: reference.youtubeId,
      title: reference.title,
      viewCount: reference.viewCount,
      thumbnailUrl: reference.thumbnailUrl,
      videoUrl: reference.videoUrl,
      channelName: reference.channelName,
      score: reference.score,
      formatLabel: reference.formatLabel || "format-reference",
      layoutBlueprint,
    },
    analysis: parsed.analysis,
    chosenFormat: parsed.chosenFormat,
    overlayText: parsed.overlayText || "",
    discoveryPlan: parsed.discoveryPlan || "",
    imagePrompt,
    whyTheseComps: parsed.whyTheseComps,
  };
}

export async function generateWithMysteryAgent(input: {
  title: string;
  notes?: string;
}) {
  const brief = await runMysteryThumbAgent(input);
  try {
    const image = await generateThumbnailFromReference({
      prompt: brief.imagePrompt,
      referenceImageUrl: brief.formatReference.thumbnailUrl,
    });
    return { brief, image };
  } catch (err) {
    console.warn(
      "[mystery-thumb-agent] reference edit failed, falling back to generate",
      err instanceof Error ? err.message : err,
    );
    const image = await generateThumbnailImage(brief.imagePrompt);
    return { brief, image };
  }
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
