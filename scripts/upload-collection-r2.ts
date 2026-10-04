import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import { readFile, writeFile } from "fs/promises";
import path from "path";

const BUCKET = process.env.R2_BUCKET || "autothumb";
const PUBLIC =
  (process.env.R2_PUBLIC_URL || "https://pub-c25f40bdebfb4d9cb7c2539a01c0854d.r2.dev").replace(
    /\/$/,
    "",
  );
const ENDPOINT =
  process.env.R2_ENDPOINT ||
  `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const CONCURRENCY = Number(process.env.R2_UPLOAD_CONCURRENCY || 12);

const prisma = new PrismaClient();

const s3 = new S3Client({
  region: "auto",
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

async function fetchThumbnail(youtubeId: string): Promise<{ bytes: Buffer; contentType: string }> {
  const candidates = [
    `https://i.ytimg.com/vi/${youtubeId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${youtubeId}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
  ];
  for (const url of candidates) {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 mlin-auto-thumb" },
    });
    if (!res.ok) continue;
    const bytes = Buffer.from(await res.arrayBuffer());
    // YouTube returns a tiny grey placeholder for missing maxres (~1KB)
    if (bytes.byteLength < 3000) continue;
    return { bytes, contentType: res.headers.get("content-type") || "image/jpeg" };
  }
  throw new Error(`No thumbnail for ${youtubeId}`);
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function main() {
  if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    throw new Error("Missing R2 credentials");
  }

  const videos = await prisma.video.findMany({
    include: { channel: true },
    orderBy: { viewCount: "desc" },
  });
  console.log(`Uploading ${videos.length} thumbnails to r2://${BUCKET} …`);

  let ok = 0;
  let fail = 0;
  const indexItems: Array<Record<string, unknown>> = [];

  await mapPool(videos, CONCURRENCY, async (video, i) => {
    const key = `collection/thumbs/${video.youtubeId}.jpg`;
    try {
      const { bytes, contentType } = await fetchThumbnail(video.youtubeId);
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      const r2ThumbnailUrl = `${PUBLIC}/${key}`;
      await prisma.video.update({
        where: { id: video.id },
        data: { r2Key: key, r2ThumbnailUrl },
      });
      indexItems.push({
        youtubeId: video.youtubeId,
        title: video.title,
        viewCount: video.viewCount,
        videoUrl: video.videoUrl,
        thumbnailUrl: r2ThumbnailUrl,
        r2Key: key,
        channel: {
          name: video.channel.name,
          handle: video.channel.handle,
          url: video.channel.url,
        },
      });
      ok += 1;
      if ((i + 1) % 25 === 0 || i + 1 === videos.length) {
        console.log(`  ${i + 1}/${videos.length} (ok=${ok} fail=${fail})`);
      }
    } catch (err) {
      fail += 1;
      console.error(`  FAIL ${video.youtubeId}:`, err instanceof Error ? err.message : err);
    }
  });

  indexItems.sort((a, b) => Number(b.viewCount) - Number(a.viewCount));
  const index = {
    generatedAt: new Date().toISOString(),
    bucket: BUCKET,
    publicBaseUrl: PUBLIC,
    minViews: 40000,
    count: indexItems.length,
    videos: indexItems,
  };
  const indexBody = Buffer.from(JSON.stringify(index));
  const indexKey = "collection/index.json";
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: indexKey,
      Body: indexBody,
      ContentType: "application/json; charset=utf-8",
      CacheControl: "public, max-age=300",
    }),
  );

  const titlesKey = "collection/titles.json";
  const titles = indexItems.map((v) => ({
    youtubeId: v.youtubeId,
    title: v.title,
    viewCount: v.viewCount,
    thumbnailUrl: v.thumbnailUrl,
    channel: (v.channel as { name: string }).name,
  }));
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: titlesKey,
      Body: Buffer.from(JSON.stringify({ count: titles.length, titles }, null, 2)),
      ContentType: "application/json; charset=utf-8",
      CacheControl: "public, max-age=300",
    }),
  );

  const out = path.join(process.cwd(), "data", "r2-index.json");
  await writeFile(out, JSON.stringify(index, null, 2));
  // touch seed file presence
  await readFile(path.join(process.cwd(), "data", "collection.json"), "utf8");

  console.log(
    JSON.stringify(
      {
        ok,
        fail,
        indexUrl: `${PUBLIC}/${indexKey}`,
        titlesUrl: `${PUBLIC}/${titlesKey}`,
        sample: `${PUBLIC}/collection/thumbs/${videos[0]?.youtubeId}.jpg`,
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
