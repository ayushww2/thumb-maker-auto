import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs/process";

export const dynamic = "force-dynamic";

const MAX_BATCH = 25;

function parseTitles(body: {
  title?: string;
  titles?: string[] | string;
}): string[] {
  const fromArray = Array.isArray(body.titles)
    ? body.titles
    : typeof body.titles === "string"
      ? body.titles.split(/\r?\n/)
      : [];
  const fromSingle = body.title ? [body.title] : [];
  const raw = [...fromArray, ...fromSingle];

  const seen = new Set<string>();
  const titles: string[] = [];
  for (const item of raw) {
    const title = String(item || "").trim();
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
  }
  return titles;
}

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
      titles?: string[] | string;
      notes?: string;
      useAgent?: boolean;
      agentType?: "mystery" | "clay" | "space" | "crown";
    };

    const titles = parseTitles(body);
    if (titles.length === 0) {
      return NextResponse.json(
        { error: "At least one title is required" },
        { status: 400 },
      );
    }
    if (titles.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `Maximum ${MAX_BATCH} titles per batch` },
        { status: 400 },
      );
    }

    const agentType =
      body.agentType === "space"
        ? "space"
        : body.agentType === "clay"
          ? "clay"
          : body.agentType === "crown"
            ? "crown"
            : "mystery";
    const notes = body.notes?.trim() || null;
    const useAgent = body.useAgent !== false;
    const progress =
      agentType === "space"
        ? "Queued — waiting for Space Thumb Agent…"
        : agentType === "clay"
          ? "Queued — waiting for Clay Thumb Agent…"
          : agentType === "crown"
            ? "Queued — waiting for Royal…"
            : "Queued — waiting for Mystery Thumb Agent…";

    const jobs = await prisma.$transaction(
      titles.map((title) =>
        prisma.job.create({
          data: {
            title,
            notes,
            useAgent,
            agentType,
            status: "queued",
            progress,
          },
        }),
      ),
    );

    for (const job of jobs) {
      enqueueJob(job.id);
    }

    const summary = jobs.map((job) => ({
      id: job.id,
      title: job.title,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
    }));

    return NextResponse.json({
      ok: true,
      count: summary.length,
      job: summary[0],
      jobs: summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Job create failed";
    console.error("[jobs]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
