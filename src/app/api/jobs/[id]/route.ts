import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs/process";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Job fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action !== "retry") {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }

    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const updated = await prisma.job.update({
      where: { id },
      data: {
        status: "queued",
        progress: "Re-queued…",
        error: null,
        completedAt: null,
      },
    });
    enqueueJob(updated.id);
    return NextResponse.json({ ok: true, job: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Job retry failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
