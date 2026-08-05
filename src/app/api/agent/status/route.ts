import { NextResponse } from "next/server";
import { getAgentStatus } from "@/lib/mysteryThumbAgent";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getAgentStatus();
    return NextResponse.json({ ok: true, ...status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent status failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
