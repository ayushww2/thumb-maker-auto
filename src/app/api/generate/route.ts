import { NextResponse } from "next/server";
import {
  craftThumbnailPrompt,
  generateThumbnailImage,
} from "@/lib/contactbox";
import { getR2Config } from "@/lib/env";
import { uploadThumbnail } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  title?: string;
  notes?: string;
  prompt?: string;
  skipUpload?: boolean;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const title = body.title?.trim();
    const notes = body.notes?.trim();
    let prompt = body.prompt?.trim();

    if (!prompt) {
      if (!title) {
        return NextResponse.json(
          { error: "Provide title (or an explicit prompt)" },
          { status: 400 },
        );
      }
      prompt = await craftThumbnailPrompt({ title, notes });
    }

    const image = await generateThumbnailImage(prompt);
    const dataUrl = `data:image/png;base64,${image.toString("base64")}`;

    let upload: { key: string; bucket: string; publicUrl: string | null } | null =
      null;
    const r2 = getR2Config();
    if (!body.skipUpload && r2.configured) {
      upload = await uploadThumbnail(image, "image/png");
    }

    return NextResponse.json({
      ok: true,
      prompt,
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
