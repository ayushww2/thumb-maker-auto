import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";

export type SeedVideo = {
  videoId: string;
  title: string;
  viewCount: number;
  channelName: string;
  channelId: string;
  channelHandle: string;
  channelUrl: string;
  durationSeconds: number | null;
  uploadDate: string | null;
  thumbnailUrl: string;
  thumbnailUrlHq: string;
  videoUrl: string;
};

export type SeedPayload = {
  minViews: number;
  videoCount: number;
  videos: SeedVideo[];
  channelsMeta?: Record<
    string,
    { channelId?: string; channelName?: string; channelUrl?: string }
  >;
};

export async function loadSeedFile(): Promise<SeedPayload> {
  const file = path.join(process.cwd(), "data", "collection.json");
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw) as SeedPayload;
}

export async function upsertCollection(payload: SeedPayload) {
  const byHandle = new Map<
    string,
    {
      handle: string;
      name: string;
      url: string;
      channelId?: string;
      videos: SeedVideo[];
    }
  >();

  for (const video of payload.videos) {
    const handle = video.channelHandle || video.channelId || "unknown";
    const meta = payload.channelsMeta?.[handle];
    if (!byHandle.has(handle)) {
      byHandle.set(handle, {
        handle,
        name: meta?.channelName || video.channelName || handle,
        url: meta?.channelUrl || video.channelUrl || "",
        channelId: meta?.channelId || video.channelId,
        videos: [],
      });
    }
    byHandle.get(handle)!.videos.push(video);
  }

  let channelsUpserted = 0;
  let videosUpserted = 0;

  for (const ch of byHandle.values()) {
    const channel = await prisma.channel.upsert({
      where: { handle: ch.handle },
      create: {
        handle: ch.handle,
        name: ch.name,
        url: ch.url,
        channelId: ch.channelId || null,
        videoCount: ch.videos.length,
      },
      update: {
        name: ch.name,
        url: ch.url,
        channelId: ch.channelId || null,
        videoCount: ch.videos.length,
      },
    });
    channelsUpserted += 1;

    for (const video of ch.videos) {
      await prisma.video.upsert({
        where: { youtubeId: video.videoId },
        create: {
          youtubeId: video.videoId,
          title: video.title,
          viewCount: video.viewCount,
          thumbnailUrl: video.thumbnailUrl,
          thumbnailUrlHq: video.thumbnailUrlHq || null,
          videoUrl: video.videoUrl,
          durationSeconds: video.durationSeconds ?? null,
          uploadDate: video.uploadDate ?? null,
          channelId: channel.id,
        },
        update: {
          title: video.title,
          viewCount: video.viewCount,
          thumbnailUrl: video.thumbnailUrl,
          thumbnailUrlHq: video.thumbnailUrlHq || null,
          videoUrl: video.videoUrl,
          durationSeconds: video.durationSeconds ?? null,
          uploadDate: video.uploadDate ?? null,
          channelId: channel.id,
        },
      });
      videosUpserted += 1;
    }
  }

  return {
    channelsUpserted,
    videosUpserted,
    minViews: payload.minViews,
  };
}

export function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(n);
}
