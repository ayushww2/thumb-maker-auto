import OpenAI from "openai";
import {
  getContactBoxApiKey,
  getContactBoxBaseUrl,
  getImageModel,
  getImageQuality,
  getImageSize,
  getReasoningModel,
} from "@/lib/env";

export function getContactBoxStatus() {
  const apiKey = getContactBoxApiKey();
  return {
    configured: Boolean(apiKey),
    baseURL: getContactBoxBaseUrl(),
    reasoningModel: getReasoningModel(),
    imageModel: getImageModel(),
    imageQuality: getImageQuality(),
    imageSize: getImageSize(),
  };
}

export function createContactBoxClient() {
  const apiKey = getContactBoxApiKey();
  if (!apiKey) {
    throw new Error("CONTACTBOX_API_KEY is not set");
  }
  return new OpenAI({
    apiKey,
    baseURL: getContactBoxBaseUrl(),
  });
}

export async function craftThumbnailPrompt(input: {
  title: string;
  notes?: string;
}): Promise<string> {
  const client = createContactBoxClient();
  const model = getReasoningModel();
  const notes = input.notes?.trim();

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content: `You write image prompts for YouTube thumbnails.
Return ONLY the prompt text, no quotes or markdown.
Rules:
- 16:9 cinematic composition, bold subject, readable negative space for a title overlay
- Photoreal or high-polish stylized — never generic AI mush
- No watermarks, no UI chrome, no logos unless asked
- Keep text-in-image minimal; prefer faces/objects over paragraphs of text
- High contrast, punchy lighting, clear focal point`,
      },
      {
        role: "user",
        content: [
          `Video title: ${input.title.trim()}`,
          notes ? `Extra direction: ${notes}` : null,
          "Write one detailed thumbnail image prompt.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });

  const prompt = completion.choices[0]?.message?.content?.trim();
  if (!prompt) throw new Error("ContactBox returned an empty thumbnail prompt");
  return prompt;
}

async function bufferFromImageResponse(item: {
  b64_json?: string | null;
  url?: string | null;
}): Promise<Buffer> {
  if (item.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item.url) {
    const res = await fetch(item.url);
    if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error("ContactBox image had neither b64_json nor url");
}

export async function generateThumbnailImage(prompt: string): Promise<Buffer> {
  const client = createContactBoxClient();
  const model = getImageModel();
  const quality = getImageQuality();
  const size = getImageSize() as
    | "1024x1024"
    | "1536x1024"
    | "1024x1536"
    | "auto";

  const result = await client.images.generate({
    model,
    prompt,
    n: 1,
    size,
    quality,
  });

  const item = result.data?.[0];
  if (!item) throw new Error("ContactBox image generation returned no data");
  return bufferFromImageResponse(item);
}

/**
 * Copy LAYOUT from a real competitor thumbnail (format reference),
 * regenerate content for the new title at forced 16:9.
 */
export async function generateThumbnailFromReference(input: {
  prompt: string;
  referenceImageUrl: string;
}): Promise<Buffer> {
  const apiKey = getContactBoxApiKey();
  if (!apiKey) throw new Error("CONTACTBOX_API_KEY is not set");

  const refRes = await fetch(input.referenceImageUrl, {
    headers: { "User-Agent": "mlin-auto-thumb" },
  });
  if (!refRes.ok) {
    throw new Error(`Failed to download format reference: ${refRes.status}`);
  }
  const refBytes = Buffer.from(await refRes.arrayBuffer());
  const contentType = refRes.headers.get("content-type") || "image/jpeg";
  const ext = contentType.includes("png") ? "png" : "jpg";

  const form = new FormData();
  form.append("model", getImageModel());
  form.append("prompt", input.prompt);
  // Always force YouTube 16:9 for format-copy edits
  form.append("size", "1536x1024");
  form.append("quality", getImageQuality());
  form.append(
    "image",
    new Blob([refBytes], { type: contentType }),
    `format-ref.${ext}`,
  );

  const base = getContactBoxBaseUrl().replace(/\/$/, "");
  const res = await fetch(`${base}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const json = (await res.json()) as {
    error?: { message?: string };
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  if (!res.ok) {
    throw new Error(json.error?.message || `images/edits failed: ${res.status}`);
  }
  const item = json.data?.[0];
  if (!item) throw new Error("images/edits returned no data");
  return bufferFromImageResponse(item);
}
