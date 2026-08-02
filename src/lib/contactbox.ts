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

  if (item.b64_json) {
    return Buffer.from(item.b64_json, "base64");
  }
  if (item.url) {
    const res = await fetch(item.url);
    if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error("ContactBox image had neither b64_json nor url");
}
