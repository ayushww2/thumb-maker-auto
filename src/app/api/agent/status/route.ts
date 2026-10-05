import { NextRequest, NextResponse } from "next/server";
import { getClayAgentStatus } from "@/lib/clayThumbAgent";
import { getAgentStatus } from "@/lib/mysteryThumbAgent";
import { getSpaceAgentStatus } from "@/lib/spaceThumbAgent";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const agent = req.nextUrl.searchParams.get("agent") || "mystery";
    if (agent === "space") {
      const status = await getSpaceAgentStatus();
      return NextResponse.json({ ok: true, ...status });
    }
    if (agent === "clay") {
      const status = await getClayAgentStatus();
      return NextResponse.json({ ok: true, ...status });
    }
    const status = await getAgentStatus();
    return NextResponse.json({ ok: true, ...status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent status failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
