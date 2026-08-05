import OpenAI from "openai";
import {
  getContactBoxApiKey,
  getContactBoxBaseUrl,
  getImageModel,
  getImageModelFallbacks,
  getImageQuality,
  getImageSize,
  getOpenAIApiKey,
  getOpenAIBaseUrl,
  getOpenAIImageModel,
  getOpenAIReasoningModel,
  getReasoningModel,
  getReasoningModelFallbacks,
} from "@/lib/env";

export type ApiProbeResult = {
  ok: boolean;
  provider: "contactbox" | "openai" | "none";
  reasoningModel?: string;
  imageModel?: string;
  availableModels?: string[];
  error?: string;
  hint?: string;
};

function humanizeApiError(message: string): string {
  if (message.includes("所属分组已删除")) {
    return "ContactBox API key is invalid — its assigned group was deleted. Create a new key in ContactBox and update CONTACTBOX_API_KEY in Railway.";
  }
  if (message.includes("No available channel for model")) {
    return `${message}. Your ContactBox group may not have this model enabled, or the API key needs to be reassigned to an active group.`;
  }
  return message;
}

function isModelAvailabilityError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /No available channel for model/i.test(msg) ||
    /model_not_found/i.test(msg) ||
    /所属分组已删除/i.test(msg) ||
    /503/.test(msg) ||
    /403/.test(msg)
  );
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function getContactBoxStatus() {
  const contactboxKey = getContactBoxApiKey();
  const openaiKey = getOpenAIApiKey();
  return {
    configured: Boolean(contactboxKey || openaiKey),
    contactboxKey: Boolean(contactboxKey),
    openaiKey: Boolean(openaiKey),
    baseURL: getContactBoxBaseUrl(),
    reasoningModel: getReasoningModel(),
    imageModel: getImageModel(),
    imageQuality: getImageQuality(),
    imageSize: getImageSize(),
    openaiReasoningModel: getOpenAIReasoningModel(),
    openaiImageModel: getOpenAIImageModel(),
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

export function createOpenAIClient() {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return new OpenAI({
    apiKey,
    baseURL: getOpenAIBaseUrl(),
  });
}

export async function probeContactBoxApi(): Promise<ApiProbeResult> {
  const contactboxKey = getContactBoxApiKey();
  const openaiKey = getOpenAIApiKey();

  if (!contactboxKey && !openaiKey) {
    return {
      ok: false,
      provider: "none",
      error: "No API key configured",
      hint: "Set CONTACTBOX_API_KEY or OPENAI_API_KEY in Railway.",
    };
  }

  if (contactboxKey) {
    try {
      const client = createContactBoxClient();
      const listed = await client.models.list();
      const availableModels = listed.data.map((m) => m.id);
      const reasoningCandidates = getReasoningModelFallbacks().filter((m) =>
        availableModels.includes(m),
      );
      const reasoningModel =
        reasoningCandidates[0] || getReasoningModelFallbacks()[0];

      await client.chat.completions.create({
        model: reasoningModel,
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
        max_tokens: 8,
      });

      return {
        ok: true,
        provider: "contactbox",
        reasoningModel,
        imageModel: getImageModel(),
        availableModels,
      };
    } catch (err) {
      const message = humanizeApiError(getErrorMessage(err));
      if (openaiKey) {
        const openaiProbe = await probeOpenAIDirect();
        if (openaiProbe.ok) {
          return {
            ...openaiProbe,
            hint: `ContactBox failed (${message}). Falling back to OpenAI.`,
          };
        }
      }
      return {
        ok: false,
        provider: "contactbox",
        error: message,
        hint: openaiKey
          ? "ContactBox failed and OpenAI fallback also failed."
          : "Generate a new ContactBox API key, or set OPENAI_API_KEY as fallback.",
      };
    }
  }

  return probeOpenAIDirect();
}

async function probeOpenAIDirect(): Promise<ApiProbeResult> {
  try {
    const client = createOpenAIClient();
    const model = getOpenAIReasoningModel();
    await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      max_tokens: 8,
    });
    return {
      ok: true,
      provider: "openai",
      reasoningModel: model,
      imageModel: getOpenAIImageModel(),
    };
  } catch (err) {
    return {
      ok: false,
      provider: "openai",
      error: humanizeApiError(getErrorMessage(err)),
      hint: "Check OPENAI_API_KEY and billing on platform.openai.com.",
    };
  }
}

async function chatCompletionsWithFallback(
  params: Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "model"> & {
    models?: string[];
  },
) {
  const { models = getReasoningModelFallbacks(), ...rest } = params;
  const errors: string[] = [];

  if (getContactBoxApiKey()) {
    const client = createContactBoxClient();
    for (const model of models) {
      try {
        return await client.chat.completions.create({ ...rest, model });
      } catch (err) {
        const msg = getErrorMessage(err);
        errors.push(`${model}: ${msg}`);
        if (!isModelAvailabilityError(err)) throw new Error(humanizeApiError(msg));
      }
    }
  }

  if (getOpenAIApiKey()) {
    const client = createOpenAIClient();
    const model = getOpenAIReasoningModel();
    try {
      return await client.chat.completions.create({ ...rest, model });
    } catch (err) {
      errors.push(`${model}: ${getErrorMessage(err)}`);
    }
  }

  throw new Error(
    humanizeApiError(
      errors.join(" | ") ||
        "All reasoning models failed. Update CONTACTBOX_API_KEY or set OPENAI_API_KEY.",
    ),
  );
}

/** Reasoning call with ContactBox model fallbacks + optional OpenAI fallback. */
export async function createReasoningCompletion(
  params: Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "model"> & {
    model?: string;
  },
) {
  const models = params.model
    ? [...new Set([params.model, ...getReasoningModelFallbacks()])]
    : getReasoningModelFallbacks();
  const { model: _ignored, ...rest } = params;
  return chatCompletionsWithFallback({ ...rest, models });
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
  throw new Error("Image response had neither b64_json nor url");
}

async function generateImageWithFallback(prompt: string): Promise<Buffer> {
  const quality = getImageQuality();
  const size = getImageSize();
  const errors: string[] = [];

  if (getContactBoxApiKey()) {
    const client = createContactBoxClient();
    for (const model of getImageModelFallbacks()) {
      try {
        const result = await client.images.generate({
          model,
          prompt,
          n: 1,
          size: size as "1024x1024" | "1536x1024" | "1024x1536" | "auto",
          quality,
        });
        const item = result.data?.[0];
        if (!item) throw new Error("Image generation returned no data");
        return bufferFromImageResponse(item);
      } catch (err) {
        const msg = getErrorMessage(err);
        errors.push(`${model}: ${msg}`);
        if (!isModelAvailabilityError(err)) throw new Error(humanizeApiError(msg));
      }
    }
  }

  if (getOpenAIApiKey()) {
    const client = createOpenAIClient();
    const model = getOpenAIImageModel();
    try {
      const result = await client.images.generate({
        model,
        prompt,
        n: 1,
        size: model === "dall-e-3" ? "1792x1024" : "1024x1024",
        quality: quality === "high" ? "hd" : "standard",
      });
      const item = result.data?.[0];
      if (!item) throw new Error("OpenAI image generation returned no data");
      return bufferFromImageResponse(item);
    } catch (err) {
      errors.push(`${model}: ${getErrorMessage(err)}`);
    }
  }

  throw new Error(
    humanizeApiError(
      errors.join(" | ") ||
        "All image models failed. Update CONTACTBOX_API_KEY or set OPENAI_API_KEY.",
    ),
  );
}

export async function craftThumbnailPrompt(input: {
  title: string;
  notes?: string;
}): Promise<string> {
  const notes = input.notes?.trim();

  const completion = await chatCompletionsWithFallback({
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
  if (!prompt) throw new Error("Reasoning model returned an empty thumbnail prompt");
  return prompt;
}

export async function generateThumbnailImage(prompt: string): Promise<Buffer> {
  return generateImageWithFallback(prompt);
}

/**
 * Copy LAYOUT from a real competitor thumbnail (format reference),
 * regenerate content for the new title at forced 16:9.
 */
export async function generateThumbnailFromReference(input: {
  prompt: string;
  referenceImageUrl: string;
}): Promise<Buffer> {
  const refRes = await fetch(input.referenceImageUrl, {
    headers: { "User-Agent": "mlin-auto-thumb" },
  });
  if (!refRes.ok) {
    throw new Error(`Failed to download format reference: ${refRes.status}`);
  }
  const refBytes = Buffer.from(await refRes.arrayBuffer());
  const contentType = refRes.headers.get("content-type") || "image/jpeg";
  const ext = contentType.includes("png") ? "png" : "jpg";
  const errors: string[] = [];

  if (getContactBoxApiKey()) {
    for (const model of getImageModelFallbacks()) {
      try {
        const form = new FormData();
        form.append("model", model);
        form.append("prompt", input.prompt);
        form.append("size", "1280x720");
        form.append("quality", getImageQuality());
        form.append(
          "image",
          new File([new Uint8Array(refBytes)], `format-ref.${ext}`, {
            type: contentType,
          }),
        );

        const base = getContactBoxBaseUrl().replace(/\/$/, "");
        const res = await fetch(`${base}/images/edits`, {
          method: "POST",
          headers: { Authorization: `Bearer ${getContactBoxApiKey()}` },
          body: form,
        });
        const json = (await res.json()) as {
          error?: { message?: string };
          data?: Array<{ b64_json?: string; url?: string }>;
        };
        if (!res.ok) {
          throw new Error(
            json.error?.message || `images/edits failed: ${res.status}`,
          );
        }
        const item = json.data?.[0];
        if (!item) throw new Error("images/edits returned no data");
        return bufferFromImageResponse(item);
      } catch (err) {
        const msg = getErrorMessage(err);
        errors.push(`${model}: ${msg}`);
        if (!isModelAvailabilityError(err)) throw new Error(humanizeApiError(msg));
      }
    }
  }

  // OpenAI edits fallback, or plain generate if edits unavailable
  try {
    return await generateImageWithFallback(input.prompt);
  } catch (err) {
    errors.push(getErrorMessage(err));
  }

  throw new Error(
    humanizeApiError(
      errors.join(" | ") ||
        "Format-reference edit failed on all providers. Update CONTACTBOX_API_KEY or set OPENAI_API_KEY.",
    ),
  );
}
