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

const PROVEN_CTR = [
  "WE HAD TO MAKE THIS HARD DECISION!",
  "PRINCESS ANNE JUST BROKE DOWN",
  "MEGHAN RUINED MY DAMN LIFE!",
  "SHE MADE DIANA'S LIFE MISERABLE",
  "SHE BEEN HIDING THESE FOR YEARS",
  "THE REASON WILLIAM HATES CAMILLA!",
  "I WARNED CHARLES FOR YEARS!",
  "CATHERINE GETS THE CROWN!",
  "CHARLES HAS CHOSEN TO STEP ASIDE!",
  "YOU'VE GONE TOO FAR HARRY!",
  "CAMILLA LEAVES WINDSOR FOREVER!",
  "THAT IS ENOUGH CAMILLA!",
  "DON'T YOU TOUCH CATHERINE!",
  "WILLIAM REVEALS IT ALL TO CHARLES",
];

const ROYAL_NAMES = [
  "WILLIAM",
  "KATE",
  "CATHERINE",
  "CAMILLA",
  "CHARLES",
  "HARRY",
  "MEGHAN",
  "ANNE",
  "DIANA",
  "OPRAH",
  "SPENCER",
];

const SHOCK_BITS = [
  "HATE",
  "RUIN",
  "OUT",
  "BAN",
  "CROWN",
  "BROKE",
  "CRIED",
  "CRY",
  "LIED",
  "SECRET",
  "EXPOS",
  "GONE",
  "ENOUGH",
  "FOREVER",
  "TOUCH",
  "HIDING",
  "STEP",
  "LEAVE",
  "LEAVES",
  "MISERABLE",
  "DAMN",
  "SHOCK",
  "KICK",
  "SOLD",
  "FLEE",
  "PLACE",
  "ORDER",
  "WARN",
  "REVEAL",
  "FAR",
  "TEAR",
  "PUSH",
  "REPORT",
  "FREEZE",
  "EXPEL",
  "EXPOSE",
];

const SOFT_BITS = [
  "SHARE",
  "MESSAGE",
  "UPDATE",
  "BEAUTIFUL",
  "TOGETHER",
  "SO HARD",
  "HEARTFELT",
  "EMOTIONAL JOURNEY",
  "LOVE",
  "BLESSED",
];

const CROWN_TEXT_LOCK = [
  "ROYAL CTR TEXT (mandatory — this is what the top thumbs actually say):",
  "Red tab, bottom-left, exact words BREAKING NEWS in white bold condensed caps.",
  "White banner across the bottom, huge black condensed ALL-CAPS, 4-7 words, ends with !",
  "The line must NAME a person and land a blow: accusation, expulsion, breakdown, secret, or crown taken.",
  "Copy the grammar of the winners, then write a NEW line for this title:",
  PROVEN_CTR.join(" · "),
  "BANNED soft lines: sharing a message, this was hard, an update, a beautiful moment, the full YouTube title.",
  "Letters razor-sharp, even, upright. No glow, chrome, script, or warped glyphs.",
].join(" ");

const CROWN_LAYOUT_LOCK = [
  "ROYAL CLICKBAIT VISUAL (mandatory — mix devices from MANY winning thumbs, do not clone one polite photo):",
  "Vertical SPLIT. Left 50%: huge paparazzi close-up, mouth open or eyes wet or a hard glare, face fills the panel.",
  "Right 50%: the target caught — palace steps, yacht, letter, car, crowd, or the person being pointed at.",
  "Add a thick RED ARROW or RED CIRCLE on the villain or the evidence. Optional tiny red-border inset photo.",
  "Bottom edge: red BREAKING NEWS tab + the white quote banner. Nothing else. No collage, no grid, no watermark, no YouTube UI.",
  "Real recognizable royal faces, harsh press flash, high contrast. Not a soft official portrait, not CGI, not illustration.",
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

function namesIn(text: string): string[] {
  const upper = text.toUpperCase();
  const found = ROYAL_NAMES.filter((name) => upper.includes(name));
  return [...new Set(found.map((name) => (name === "KATE" ? "CATHERINE" : name)))];
}

function isHighCtrLine(line: string): boolean {
  const upper = line.toUpperCase();
  if (SOFT_BITS.some((bit) => upper.includes(bit))) return false;
  const words = upper.split(/\s+/).filter(Boolean);
  if (words.length < 3 || words.length > 8) return false;
  const hasName = namesIn(upper).length > 0;
  const hasShock = SHOCK_BITS.some((bit) => upper.includes(bit));
  return hasName && hasShock;
}

function clickVisualScore(composition: string, overlay: string): number {
  const blob = `${composition}\n${overlay}`.toUpperCase();
  let score = 0;
  if (/\bSPLIT\b/.test(blob)) score += 4;
  if (/ARROW/.test(blob)) score += 4;
  if (/INSET|RED-BORDER|RED BORDER|FRAMED/.test(blob)) score += 2;
  if (/CRY|TEAR|ANGR|FURY|SHOUT|DISTRESS/.test(blob)) score += 2;
  if (/SINGLE IMAGE|TWO-PERSON PORTRAIT|BOTH FACING/.test(blob) && !/\bSPLIT\b/.test(blob)) {
    score -= 6;
  }
  const quote = overlay.replace(/BREAKING NEWS/gi, " ").replace(/[“”"]/g, "").trim();
  if (isHighCtrLine(quote)) score += 2;
  return score;
}

function clickbaitFromTitle(title: string): string {
  const names = namesIn(title);
  const a = names[0] || "CAMILLA";
  const b = names.find((name) => name !== a) || (a === "CAMILLA" ? "WILLIAM" : "CAMILLA");
  const upper = title.toUpperCase();
  if (/CROWN|THRONE|QUEEN/.test(upper)) return `${a} GETS THE CROWN!`;
  if (/HATE|FURIOUS|SLAM|BULLY/.test(upper)) return `THE REASON ${b} HATES ${a}!`;
  if (/HID|SECRET|LETTER|LEAK|REPORT/.test(upper)) return `${a} BEEN HIDING THIS FOR YEARS!`;
  if (/OUT|BAN|ORDER|KICK|BAR|LEAVE|FLEE|EXPEL/.test(upper)) return `${a} LEAVES FOREVER!`;
  if (/BROKE|CRY|DEVASTAT|COLLAPS|TEAR/.test(upper)) return `${a} JUST BROKE DOWN!`;
  if (/RUIN|SOLD|MONEY|MANSION/.test(upper)) return `${a} RUINED EVERYTHING!`;
  if (/MESSAGE|SHARE|UPDATE|ANNOUNCE/.test(upper)) return `${b} EXPOSED ${a}!`;
  if (names.length >= 2) return `DON'T YOU TOUCH ${a}!`;
  return `${a} JUST BROKE DOWN!`;
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
  if (!isHighCtrLine(line)) line = clickbaitFromTitle(title);
  if (!line.endsWith("!")) line = `${line.replace(/!+$/, "")}!`;
  return `"${line}"`;
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
    const overlayText = (v.thumbScan?.overlayText || "").replace(/\s+/g, " ").trim();
    const composition = (v.thumbScan?.composition || "").replace(/\s+/g, " ").trim();
    const clickScore = clickVisualScore(composition, overlayText);
    return {
      youtubeId: v.youtubeId,
      title: v.title,
      viewCount: v.viewCount,
      thumbnailUrl: v.r2ThumbnailUrl || v.thumbnailUrl,
      videoUrl: v.videoUrl,
      channelName: v.channel.name,
      overlayText,
      composition,
      score,
      clickScore,
      fitness:
        score * 0.25 +
        Math.min(0.35, Math.log10(v.viewCount + 1) / 14) +
        clickScore * 0.08 +
        (overlayText ? 0.08 : 0),
    };
  });
  scored.sort((a, b) => b.fitness - a.fitness || b.viewCount - a.viewCount);

  // Every scanned winner, plus the closest title matches, so the brief is not one photo.
  const scanned = scored.filter((item) => item.overlayText);
  const board = [...scanned, ...scored.slice(0, 8)]
    .filter(
      (item, index, all) =>
        all.findIndex((other) => other.youtubeId === item.youtubeId) === index,
    )
    .slice(0, 18);
  const moreTitles = scored
    .slice()
    .sort((a, b) => b.viewCount - a.viewCount)
    .slice(0, 30)
    .map((item) => `${Math.round(item.viewCount / 1000)}K — ${item.title}`);

  const clickbaitFirst = [...scored].sort(
    (a, b) => b.clickScore - a.clickScore || b.viewCount - a.viewCount,
  );
  let reference = { ...clickbaitFirst[0], isFormatReference: true as const };
  for (const candidate of clickbaitFirst.filter((item) => item.clickScore >= 4).slice(0, 6)) {
    if (await canFetchReferenceImage(candidate.thumbnailUrl)) {
      reference = { ...candidate, isFormatReference: true as const };
      break;
    }
  }
  const shortlist = clickbaitFirst.slice(0, 8).map((item) => {
    const { fitness: _fitness, ...rest } = item;
    return rest;
  });
  return { reference, shortlist, board, moreTitles };
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
  const ctrExamples = [
    ...PROVEN_CTR,
    ...(playbook.ctrTexts || []),
    ...picked.board.map((item) => item.overlayText).filter(Boolean),
  ]
    .filter((line, index, all) => all.indexOf(line) === index)
    .slice(0, 18)
    .join(" · ");
  const thumbBoard = picked.board
    .map(
      (item, index) =>
        `${index + 1}. ${item.viewCount.toLocaleString()} views — ${item.title}
   banner: ${item.overlayText || "(same BREAKING NEWS + quote package)"}
   visual: ${item.composition || "split close-up + scandal scene, red arrow on the target"}`,
    )
    .join("\n");

  let content = "";
  try {
    const completion = await createReasoningCompletion({
      temperature: 0.55,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content: `You are the Royal thumb agent. You have studied many high-view royal thumbs, not one photo.
Steal the CLICK from the whole set: split-screen fury, red arrow, BREAKING NEWS, a short vicious quote.
The banner is NOT the YouTube title and it is NOT a soft feeling. Name someone and hit them.
${CROWN_LAYOUT_LOCK}
${CROWN_TEXT_LOCK}
Return STRICT JSON only:
{
  "analysis": "which of the listed thumbs you are mixing and why",
  "chosenFormat": "split + red arrow | split + inset | two-shot accusation",
  "overlayText": "4-7 word ALL-CAPS quote that names a person and a blow",
  "discoveryPlan": "LEFT face (emotion) and RIGHT target (scene). Name both people.",
  "imagePrompt": "one-thumbnail edit: split, red arrow, BREAKING NEWS, exact banner",
  "whyTheseComps": "which winning banners you matched"
}`,
        },
        {
          role: "user",
          content: `NEW TITLE: ${title}
${input.notes?.trim() ? `EXTRA: ${input.notes.trim()}` : ""}

SCANNED WINNERS TO MIX (banner + visual). Do not copy just one photo:
${thumbBoard}

MORE HIGH-VIEW THUMBS FROM THE SAME CHANNEL (same click package):
${picked.moreTitles.join("\n")}

LAYOUT STILL WE WILL EDIT (${picked.reference.viewCount.toLocaleString()} views, clickbait layout): ${picked.reference.title}
banner: ${picked.reference.overlayText || "BREAKING NEWS + vicious quote"}
${blueprint}

CTR LINES THAT GOT THE VIEWS:
${ctrExamples}

Produce JSON now. The overlay must name a person and land a blow. Reject sympathy, sharing, and message lines.`,
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

  const faces = parsed.discoveryPlan.replace(/\s+/g, " ").trim().slice(0, 280);
  const imagePrompt = [
    "EDIT this thumbnail. Keep the clickbait layout devices only. Replace every face, scene, and banner word.",
    "ONE 16:9 image, not a collage and not a grid.",
    "Vertical split. Left half: huge paparazzi close-up, mouth open or eyes wet or a hard glare, face fills the panel.",
    "Right half: the target caught at a palace, yacht, car, letter, or crowd. Thick RED ARROW pointing at them.",
    "Bottom-left red tab, white condensed caps, exact words: BREAKING NEWS",
    `White banner, huge black condensed ALL-CAPS, exact text and no other words: ${parsed.overlayText}`,
    faces,
    "Harsh press flash, high contrast, real recognizable royal faces. Not a soft official portrait. No watermark. No YouTube UI. 1280x720.",
  ]
    .filter(Boolean)
    .join(" ");

  const generatePrompt = [
    "ONE photoreal 16:9 royal clickbait thumbnail, not a collage.",
    "Vertical split. Huge furious or crying face on the left. Target caught on the right. Thick red arrow on the target.",
    "Bottom-left red tab, exact text: BREAKING NEWS",
    `White banner, huge black condensed ALL-CAPS, exact text: ${parsed.overlayText}`,
    faces,
    "Harsh press flash. Real faces. No watermark. No YouTube UI. 1280x720.",
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
