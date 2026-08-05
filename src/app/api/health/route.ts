import { NextResponse } from "next/server";
import { getContactBoxStatus, probeContactBoxApi } from "@/lib/contactbox";
import { prisma } from "@/lib/db";
import { getR2Config } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const contactbox = getContactBoxStatus();
  const r2 = getR2Config();
  const probe = await probeContactBoxApi();
  let dbOk = false;
  let videoCount = 0;
  let jobCount = 0;
  let runningJobs = 0;

  try {
    videoCount = await prisma.video.count();
    jobCount = await prisma.job.count();
    runningJobs = await prisma.job.count({
      where: { status: { in: ["queued", "running"] } },
    });
    dbOk = true;
  } catch {
    dbOk = false;
  }

  return NextResponse.json({
    ok: probe.ok && dbOk,
    service: "mlin-auto-thumb-maker",
    time: new Date().toISOString(),
    contactbox: {
      configured: contactbox.configured,
      contactboxKey: contactbox.contactboxKey,
      openaiKey: contactbox.openaiKey,
      baseURL: contactbox.baseURL,
      reasoningModel: contactbox.reasoningModel,
      imageModel: contactbox.imageModel,
      imageQuality: contactbox.imageQuality,
      imageSize: contactbox.imageSize,
      apiOk: probe.ok,
      activeProvider: probe.provider,
      activeReasoningModel: probe.reasoningModel || null,
      activeImageModel: probe.imageModel || null,
      availableModels: probe.availableModels || [],
      apiError: probe.error || null,
      apiHint: probe.hint || null,
    },
    database: {
      configured: Boolean(process.env.DATABASE_URL),
      ok: dbOk,
      videos: videoCount,
      jobs: jobCount,
      activeJobs: runningJobs,
    },
    r2: {
      configured: r2.configured,
      bucket: r2.bucket,
      accountId: r2.accountId ? `${r2.accountId.slice(0, 6)}…` : "",
      publicBaseUrl: r2.publicBaseUrl || null,
    },
    agent: {
      name: "mystery-thumb-agent",
      reasoningModel: probe.reasoningModel || contactbox.reasoningModel,
      imageModel: probe.imageModel || contactbox.imageModel,
      provider: probe.provider,
    },
  });
}
