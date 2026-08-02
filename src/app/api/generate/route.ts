import { NextResponse } from "next/server";
import { generateThumbnailImage } from "@/lib/contactbox";
import { getR2Config } from "@/lib/env";
import { generateWithMysteryAgent } from "@/lib/mysteryThumbAgent";
import { uploadThumbnail } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  title?: string;
  notes?: string;
  prompt?: string;
  skipUpload?: boolean;
  useAgent?: boolean;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const title = body.title?.trim();
    const notes = body.notes?.trim();
    const useAgent = body.useAgent !== false;

    if (!title && !body.prompt?.trim()) {
      return NextResponse.json(
        { error: "Provide title (or an explicit prompt)" },
        { status: 400 },
      );
    }

    let prompt = body.prompt?.trim() || "";
    let agentPayload: Awaited<
      ReturnType<typeof generateWithMysteryAgent>
    >["brief"] | null = null;
    let image: Buffer;

    if (useAgent && title && !body.prompt?.trim()) {
      const result = await generateWithMysteryAgent({ title, notes });
      agentPayload = result.brief;
      prompt = result.brief.imagePrompt;
      image = result.image;
    } else {
      if (!prompt) {
        return NextResponse.json({ error: "Prompt required" }, { status: 400 });
      }
      image = await generateThumbnailImage(prompt);
    }

    const dataUrl = `data:image/png;base64,${image.toString("base64")}`;

    let upload: { key: string; bucket: string; publicUrl: string | null } | null =
      null;
    const r2 = getR2Config();
    if (!body.skipUpload && r2.configured) {
      upload = await uploadThumbnail(image, "image/png");
    }

    return NextResponse.json({
      ok: true,
      agent: agentPayload?.agent || null,
      prompt,
      analysis: agentPayload?.analysis || null,
      chosenFormat: agentPayload?.chosenFormat || null,
      overlayText: agentPayload?.overlayText || null,
      whyTheseComps: agentPayload?.whyTheseComps || null,
      competitors: agentPayload?.competitors || [],
      playbookSummary: agentPayload?.playbook.summary || null,
      image: {
        contentType: "image/png",
        dataUrl,
        bytes: image.byteLength,
      },
      upload,
      r2Configured: r2.configured,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generate failed";
    console.error("[generate]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
