import { NextResponse } from "next/server";
import { loadSeedFile, upsertCollection } from "@/lib/collection";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const secret = process.env.COLLECTION_SEED_SECRET || "";
    if (secret) {
      const header = req.headers.get("x-seed-secret") || "";
      if (header !== secret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const payload = await loadSeedFile();
    const result = await upsertCollection(payload);
    return NextResponse.json({ ok: true, ...result, sourceCount: payload.videoCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Seed failed";
    console.error("[collection/seed]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
