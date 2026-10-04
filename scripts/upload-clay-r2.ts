/**
 * Mirror Clay Mysteries competitor thumbnails (≥100K) into R2.
 * Prefix: collection/clay/thumbs/{youtubeId}.jpg
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import { writeFile } from "fs/promises";
import path from "path";

const BUCKET = process.env.R2_BUCKET || "autothumb";
const PUBLIC = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");
const ENDPOINT =
  process.env.R2_ENDPOINT ||
  `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const CONCURRENCY = Number(process.env.R2_UPLOAD_CONCURRENCY || 10);
const NICHE = "clay-mysteries";
const MIN_VIEWS = 100_000;

const prisma = new PrismaClient();
const s3 = new S3Client({
  region: "auto",
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

async function fetchThumbnail(youtubeId: string, fallbackUrl?: string) {
  const candidates = [
    fallbackUrl,
    `https://i.ytimg.com/vi/${youtubeId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${youtubeId}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
  ].filter(Boolean) as string[];
  for (const url of candidates) {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 mlin-auto-thumb-clay" },
    });
    if (!res.ok) continue;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength < 3000) continue;
    return { bytes, contentType: res.headers.get("content-type") || "image/jpeg" };
  }
  throw new Error(`No thumbnail for ${youtubeId}`);
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
}

async function main() {
  if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    throw new Error("Missing R2 credentials");
  }

  const videos = await prisma.video.findMany({
    where: { niche: NICHE, viewCount: { gte: MIN_VIEWS } },
    include: { channel: true },
    orderBy: { viewCount: "desc" },
  });
  console.log(`Uploading ${videos.length} clay thumbs to R2…`);

  let ok = 0;
  let fail = 0;
  const index: Array<Record<string, unknown>> = [];

  await mapPool(videos, CONCURRENCY, async (video, i) => {
    const key = `collection/clay/thumbs/${video.youtubeId}.jpg`;
    try {
      const { bytes, contentType } = await fetchThumbnail(
        video.youtubeId,
        video.thumbnailUrlHq || video.thumbnailUrl,
      );
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: bytes,
          ContentType: contentType,
        }),
      );
      const publicUrl = PUBLIC ? `${PUBLIC}/${key}` : null;
      await prisma.video.update({
        where: { id: video.id },
        data: {
          r2Key: key,
          r2ThumbnailUrl: publicUrl,
        },
      });
      index.push({
        youtubeId: video.youtubeId,
        title: video.title,
        viewCount: video.viewCount,
        channel: video.channel.name,
        niche: NICHE,
        r2Key: key,
        r2Url: publicUrl,
        youtubeThumb: video.thumbnailUrl,
      });
      ok += 1;
      if ((i + 1) % 20 === 0 || i === videos.length - 1) {
        console.log(`  ${i + 1}/${videos.length} ok=${ok} fail=${fail}`);
      }
    } catch (err) {
      fail += 1;
      console.warn(
        `fail ${video.youtubeId}`,
        err instanceof Error ? err.message : err,
      );
    }
  });

  const indexKey = "collection/clay/index.json";
  const indexBody = Buffer.from(
    JSON.stringify(
      {
        niche: NICHE,
        minViews: MIN_VIEWS,
        generatedAt: new Date().toISOString(),
        count: index.length,
        videos: index,
      },
      null,
      2,
    ),
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: indexKey,
      Body: indexBody,
      ContentType: "application/json",
    }),
  );
  await writeFile(
    path.join(process.cwd(), "data", "clay-r2-index.json"),
    indexBody,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        uploaded: ok,
        failed: fail,
        indexUrl: PUBLIC ? `${PUBLIC}/${indexKey}` : null,
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
