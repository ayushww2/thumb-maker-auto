import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const channel = (searchParams.get("channel") || "").trim();
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") || 24)));
    const sort = searchParams.get("sort") || "views";

    const where = {
      r2ThumbnailUrl: { not: null },
      ...(channel
        ? {
            channel: {
              OR: [{ handle: channel }, { name: channel }, { channelId: channel }],
            },
          }
        : {}),
      ...(q
        ? {
            title: { contains: q, mode: "insensitive" as const },
          }
        : {}),
    };

    const orderBy =
      sort === "title"
        ? { title: "asc" as const }
        : sort === "newest"
          ? { updatedAt: "desc" as const }
          : { viewCount: "desc" as const };

    const [total, videos, channels, mirrored] = await Promise.all([
      prisma.video.count({ where }),
      prisma.video.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          channel: {
            select: { id: true, name: true, handle: true, url: true },
          },
        },
      }),
      prisma.channel.findMany({
        orderBy: { videoCount: "desc" },
        select: { id: true, name: true, handle: true, url: true, videoCount: true },
      }),
      prisma.video.count({ where: { r2ThumbnailUrl: { not: null } } }),
    ]);

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      q,
      channel,
      sort,
      publicBaseUrl: process.env.R2_PUBLIC_URL || null,
      indexUrl: process.env.R2_PUBLIC_URL
        ? `${process.env.R2_PUBLIC_URL.replace(/\/$/, "")}/collection/index.json`
        : null,
      stats: {
        mirrored,
        channels: channels.length,
      },
      channels,
      videos: videos.map((v) => ({
        id: v.id,
        youtubeId: v.youtubeId,
        title: v.title,
        viewCount: v.viewCount,
        videoUrl: v.videoUrl,
        r2Key: v.r2Key,
        thumbnailUrl: v.r2ThumbnailUrl,
        channel: v.channel,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Library query failed";
    console.error("[library]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
