import { NextResponse } from "next/server";
import { getContactBoxStatus } from "@/lib/contactbox";
import { prisma } from "@/lib/db";
import { getR2Config } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const contactbox = getContactBoxStatus();
  const r2 = getR2Config();
  let dbOk = false;
  let videoCount = 0;

  try {
    videoCount = await prisma.video.count();
    dbOk = true;
  } catch {
    dbOk = false;
  }

  return NextResponse.json({
    ok: contactbox.configured && dbOk,
    service: "mlin-auto-thumb-maker",
    time: new Date().toISOString(),
    contactbox: {
      configured: contactbox.configured,
      baseURL: contactbox.baseURL,
      reasoningModel: contactbox.reasoningModel,
      imageModel: contactbox.imageModel,
      imageQuality: contactbox.imageQuality,
      imageSize: contactbox.imageSize,
    },
    database: {
      configured: Boolean(process.env.DATABASE_URL),
      ok: dbOk,
      videos: videoCount,
    },
    r2: {
      configured: r2.configured,
      bucket: r2.bucket,
      accountId: r2.accountId ? `${r2.accountId.slice(0, 6)}…` : "",
      publicBaseUrl: r2.publicBaseUrl || null,
    },
    agent: {
      name: "mystery-thumb-agent",
      reasoningModel: contactbox.reasoningModel,
      imageModel: contactbox.imageModel,
    },
  });
}
