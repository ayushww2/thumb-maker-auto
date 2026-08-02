import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const MIN_VIEWS_DEFAULT = 40_000;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const channel = (searchParams.get("channel") || "").trim();
    const minViews = Number(searchParams.get("minViews") || MIN_VIEWS_DEFAULT);
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") || 24)));
    const sort = searchParams.get("sort") || "views";

    const where = {
      viewCount: { gte: Number.isFinite(minViews) ? minViews : MIN_VIEWS_DEFAULT },
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
          ? { indexedAt: "desc" as const }
          : { viewCount: "desc" as const };

    const [total, videos, channels, stats] = await Promise.all([
      prisma.video.count({ where }),
      prisma.video.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          channel: {
            select: { id: true, name: true, handle: true, url: true, channelId: true },
          },
        },
      }),
      prisma.channel.findMany({
        orderBy: { videoCount: "desc" },
        select: {
          id: true,
          name: true,
          handle: true,
          url: true,
          videoCount: true,
          channelId: true,
        },
      }),
      prisma.video.aggregate({
        where: { viewCount: { gte: MIN_VIEWS_DEFAULT } },
        _count: true,
        _max: { viewCount: true },
        _sum: { viewCount: true },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      q,
      channel,
      minViews,
      sort,
      stats: {
        videos: stats._count,
        maxViews: stats._max.viewCount || 0,
        sumViews: stats._sum.viewCount || 0,
        channels: channels.length,
      },
      channels,
      videos,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Collection query failed";
    console.error("[collection]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
