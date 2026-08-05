import { NextResponse } from "next/server";
import { buildMysteryPlaybook } from "@/lib/mysteryThumbAgent";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    const playbook = await buildMysteryPlaybook(false);
    return NextResponse.json({ ok: true, playbook });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Playbook load failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const secret = process.env.COLLECTION_SEED_SECRET || "";
    if (secret) {
      const header = req.headers.get("x-seed-secret") || "";
      if (header !== secret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
    const force =
      (await req.json().catch(() => ({})))?.force !== false;
    const playbook = await buildMysteryPlaybook(force);
    return NextResponse.json({ ok: true, playbook });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Playbook build failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
