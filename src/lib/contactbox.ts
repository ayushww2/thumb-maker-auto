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
  getReasoningStreaming,
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
    reasoningStreaming: getReasoningStreaming(),
  };
}

async function completionFromStream(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  model: string,
): Promise<OpenAI.Chat.ChatCompletion> {
  let content = "";
  for await (const chunk of stream) {
    content += chunk.choices[0]?.delta?.content ?? "";
  }
  return {
    id: `stream-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content, refusal: null },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
  } as OpenAI.Chat.ChatCompletion;
}

async function createChatCompletion(
  client: OpenAI,
  params: Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "model"> & {
    model: string;
  },
): Promise<OpenAI.Chat.ChatCompletion> {
  // Always prefer streaming for prompts; fall back to non-stream if empty/fail.
  if (getReasoningStreaming()) {
    try {
      const stream = await client.chat.completions.create({
        ...params,
        stream: true,
      });
      const completion = await completionFromStream(stream, params.model);
      const text = completion.choices[0]?.message?.content?.trim() || "";
      if (text) return completion;
      console.warn(
        "[contactbox] stream returned empty content; retrying non-stream",
        params.model,
      );
    } catch (err) {
      console.warn(
        "[contactbox] stream failed; retrying non-stream",
        params.model,
        getErrorMessage(err),
      );
    }
  }
  return client.chat.completions.create(params);
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
      const preferred = getReasoningModel();
      const reasoningCandidates = [
        preferred,
        ...getReasoningModelFallbacks().filter((m) => m !== preferred),
      ].filter((m) => availableModels.includes(m));
      const reasoningModel =
        reasoningCandidates[0] || preferred;

      await createChatCompletion(client, {
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
        return await createChatCompletion(client, { ...rest, model });
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
      return await createChatCompletion(client, { ...rest, model });
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

function isSoftImageEditError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    isModelAvailabilityError(err) ||
    /failed to download file/i.test(msg) ||
    /error while downloading file/i.test(msg) ||
    /error getting file type/i.test(msg) ||
    /upstream status code:\s*404/i.test(msg) ||
    /invalid_image/i.test(msg) ||
    /unsupported image/i.test(msg) ||
    /404/.test(msg) ||
    /timed? ?out/i.test(msg) ||
    /ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg)
  );
}

async function downloadReferenceBytes(
  referenceImageUrl: string,
): Promise<{ bytes: Buffer; contentType: string; ext: string }> {
  const youtubeIdMatch = referenceImageUrl.match(/\/(?:vi|thumbs)\/([A-Za-z0-9_-]{11})\b/);
  const youtubeId = youtubeIdMatch?.[1];
  const candidates = [
    referenceImageUrl,
    youtubeId
      ? `https://pub-c25f40bdebfb4d9cb7c2539a01c0854d.r2.dev/collection/space/thumbs/${youtubeId}.jpg`
      : "",
    youtubeId
      ? `https://pub-c25f40bdebfb4d9cb7c2539a01c0854d.r2.dev/collection/clay/thumbs/${youtubeId}.jpg`
      : "",
    youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/maxresdefault.jpg` : "",
    youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/sddefault.jpg` : "",
    youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : "",
  ].filter(Boolean);

  const errors: string[] = [];
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "mlin-auto-thumb" },
      });
      if (!res.ok) {
        errors.push(`${url} -> ${res.status}`);
        continue;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.byteLength < 2500) {
        errors.push(`${url} -> too small (${bytes.byteLength})`);
        continue;
      }
      const contentType = res.headers.get("content-type") || "image/jpeg";
      const ext = contentType.includes("png") ? "png" : "jpg";
      return { bytes, contentType, ext };
    } catch (err) {
      errors.push(`${url} -> ${getErrorMessage(err)}`);
    }
  }
  throw new Error(
    `Failed to download format reference (${errors.slice(0, 3).join(" | ")})`,
  );
}

/** Download a thumb and return a data URL ContactBox vision can read without upstream fetch. */
export async function resolveImageDataUrl(
  referenceImageUrl: string,
): Promise<string> {
  const { bytes, contentType } = await downloadReferenceBytes(referenceImageUrl);
  const mime = contentType.includes("png")
    ? "image/png"
    : contentType.includes("webp")
      ? "image/webp"
      : "image/jpeg";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/**
 * Best-effort vision URL: prefer data URL so ContactBox never 404s on remote thumbs.
 * Falls back to the original URL if every download candidate fails.
 */
export async function resolveVisionImageUrl(
  referenceImageUrl: string,
): Promise<string> {
  try {
    return await resolveImageDataUrl(referenceImageUrl);
  } catch (err) {
    console.warn(
      "[contactbox] vision data-url resolve failed; using remote url",
      getErrorMessage(err),
    );
    return referenceImageUrl;
  }
}

function extractB64FromUnknown(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;
  if (typeof e.b64_json === "string" && e.b64_json) return e.b64_json;
  if (typeof e.partial_image_b64 === "string" && e.partial_image_b64) {
    return e.partial_image_b64;
  }
  const data = e.data;
  if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
    const first = data[0] as Record<string, unknown>;
    if (typeof first.b64_json === "string" && first.b64_json) {
      return first.b64_json;
    }
    if (
      typeof first.partial_image_b64 === "string" &&
      first.partial_image_b64
    ) {
      return first.partial_image_b64;
    }
  }
  return null;
}

async function bufferFromImageStream(
  stream: AsyncIterable<unknown>,
): Promise<Buffer> {
  let lastB64: string | null = null;
  for await (const event of stream) {
    const e = event as Record<string, unknown>;
    const type = String(e.type || "");
    const b64 = extractB64FromUnknown(event);
    if (b64) lastB64 = b64;
    if (
      type.includes("completed") ||
      type === "image_generation.completed" ||
      type === "image_edit.completed" ||
      (e as { status?: string }).status === "completed"
    ) {
      break;
    }
  }
  if (!lastB64) {
    throw new Error("Image stream completed without image data");
  }
  return Buffer.from(lastB64, "base64");
}

/** Parse SSE / NDJSON image stream body from ContactBox edits/generate. */
async function bufferFromSseResponse(res: Response): Promise<Buffer> {
  const body = await res.text();
  let lastB64: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "data: [DONE]") continue;
    const payload = trimmed.startsWith("data:")
      ? trimmed.slice(5).trim()
      : trimmed;
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload) as unknown;
      const b64 = extractB64FromUnknown(parsed);
      if (b64) lastB64 = b64;
      // Also handle nested response wrappers
      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { data?: unknown[] }).data)
      ) {
        const nested = extractB64FromUnknown(parsed);
        if (nested) lastB64 = nested;
      }
    } catch {
      // ignore non-JSON keepalives
    }
  }
  if (!lastB64) {
    // Some gateways return a final JSON object instead of SSE
    try {
      const json = JSON.parse(body) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };
      const item = json.data?.[0];
      if (item) return bufferFromImageResponse(item);
    } catch {
      // fall through
    }
    throw new Error("Image SSE completed without image data");
  }
  return Buffer.from(lastB64, "base64");
}

async function generateImageWithFallback(prompt: string): Promise<Buffer> {
  const quality = getImageQuality();
  const size = getImageSize();
  const errors: string[] = [];

  if (getContactBoxApiKey()) {
    const client = createContactBoxClient();
    for (const model of getImageModelFallbacks()) {
      // Prefer streaming high-quality generation (user requested streaming for thumbs).
      try {
        const stream = (await client.images.generate({
          model,
          prompt,
          n: 1,
          size: size as "1024x1024" | "1536x1024" | "1024x1536" | "auto",
          quality,
          stream: true,
          partial_images: 1,
        } as OpenAI.Images.ImageGenerateParams & {
          stream: true;
          partial_images: number;
        })) as unknown as AsyncIterable<unknown>;
        return await bufferFromImageStream(stream);
      } catch (err) {
        const msg = getErrorMessage(err);
        errors.push(`${model}/stream: ${msg}`);
        // Fall through to non-stream for this model
      }

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
        if (!isModelAvailabilityError(err) && !isSoftImageEditError(err)) {
          // continue trying other models for soft failures
        }
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
- Photoreal documentary realism — real materials, natural lighting, camera depth; never generic AI mush or plastic CGI
- Keep on-image text thick, ultra-sharp, high-contrast ALL-CAPS when used (text treatment must stay excellent)
- Unique title-specific props/details — not recycled generic objects
- Lighten objects/subjects: lifted midtones, clean highlights; avoid crushed muddy blacks
- No watermarks, no UI chrome, no logos unless asked
- High contrast, punchy-but-natural lighting, clear focal point`,
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
 * Soft-fails edit/download issues into high-quality streaming generate.
 */
export async function generateThumbnailFromReference(input: {
  prompt: string;
  referenceImageUrl: string;
}): Promise<Buffer> {
  const errors: string[] = [];
  let ref:
    | { bytes: Buffer; contentType: string; ext: string }
    | null = null;

  try {
    ref = await downloadReferenceBytes(input.referenceImageUrl);
  } catch (err) {
    const msg = getErrorMessage(err);
    errors.push(`ref-download: ${msg}`);
    console.warn(
      "[contactbox] format-ref download failed; using streaming generate",
      msg,
    );
  }

  if (ref && getContactBoxApiKey()) {
    const { bytes: refBytes, contentType, ext } = ref;
    for (const model of getImageModelFallbacks()) {
      // Prefer streaming edits (partial images) for speed + reliability.
      try {
        const form = new FormData();
        form.append("model", model);
        form.append("prompt", input.prompt);
        form.append("size", getImageSize());
        form.append("quality", getImageQuality());
        form.append("stream", "true");
        form.append("partial_images", "1");
        form.append(
          "image",
          new Blob([new Uint8Array(refBytes)], { type: contentType }),
          `format-ref.${ext}`,
        );

        const base = getContactBoxBaseUrl().replace(/\/$/, "");
        const res = await fetch(`${base}/images/edits`, {
          method: "POST",
          headers: { Authorization: `Bearer ${getContactBoxApiKey()}` },
          body: form,
        });
        const contentTypeHeader = res.headers.get("content-type") || "";
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          throw new Error(
            json.error?.message || `images/edits stream failed: ${res.status}`,
          );
        }
        if (
          contentTypeHeader.includes("text/event-stream") ||
          contentTypeHeader.includes("ndjson") ||
          contentTypeHeader.includes("octet-stream")
        ) {
          return await bufferFromSseResponse(res);
        }
        // Gateway may still return JSON even when stream=true was requested.
        const json = (await res.json()) as {
          error?: { message?: string };
          data?: Array<{ b64_json?: string; url?: string }>;
        };
        const item = json.data?.[0];
        if (!item) throw new Error("images/edits stream returned no data");
        return bufferFromImageResponse(item);
      } catch (err) {
        const msg = getErrorMessage(err);
        errors.push(`${model}/edit-stream: ${msg}`);
        console.warn("[contactbox] edits stream failed; trying non-stream", msg);
      }

      try {
        const form = new FormData();
        form.append("model", model);
        form.append("prompt", input.prompt);
        form.append("size", getImageSize());
        form.append("quality", getImageQuality());
        form.append(
          "image",
          new Blob([new Uint8Array(refBytes)], { type: contentType }),
          `format-ref.${ext}`,
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
        errors.push(`${model}/edit: ${msg}`);
        // Soft-fail edits (404 file type, download errors, etc.) and keep trying.
        if (!isSoftImageEditError(err) && !isModelAvailabilityError(err)) {
          console.warn("[contactbox] edits hard error, will try generate", msg);
        }
      }
    }
  }

  // Always fall through to high-quality streaming generate rather than failing the job.
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
