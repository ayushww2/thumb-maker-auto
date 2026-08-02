import { NextResponse } from "next/server";
import { getContactBoxStatus } from "@/lib/contactbox";
import { getR2Config } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const contactbox = getContactBoxStatus();
  const r2 = getR2Config();

  return NextResponse.json({
    ok: contactbox.configured,
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
    r2: {
      configured: r2.configured,
      bucket: r2.bucket,
      accountId: r2.accountId ? `${r2.accountId.slice(0, 6)}…` : "",
      publicBaseUrl: r2.publicBaseUrl || null,
    },
  });
}
