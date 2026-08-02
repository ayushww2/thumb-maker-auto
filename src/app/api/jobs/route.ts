import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs/process";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = (searchParams.get("status") || "").trim();
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const pageSize = Math.min(50, Math.max(1, Number(searchParams.get("pageSize") || 20)));

    const where = status ? { status } : {};
    const [total, jobs] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          title: true,
          notes: true,
          status: true,
          progress: true,
          error: true,
          imageUrl: true,
          imageBytes: true,
          chosenFormat: true,
          overlayText: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
        },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      jobs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Jobs list failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      title?: string;
      notes?: string;
      useAgent?: boolean;
    };
    const title = body.title?.trim();
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const job = await prisma.job.create({
      data: {
        title,
        notes: body.notes?.trim() || null,
        useAgent: body.useAgent !== false,
        status: "queued",
        progress: "Queued — waiting for Mystery Thumb Agent…",
      },
    });

    enqueueJob(job.id);

    return NextResponse.json({
      ok: true,
      job: {
        id: job.id,
        title: job.title,
        status: job.status,
        progress: job.progress,
        createdAt: job.createdAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Job create failed";
    console.error("[jobs]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
