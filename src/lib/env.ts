export function getContactBoxApiKey(): string {
  return process.env.CONTACTBOX_API_KEY || "";
}

export function getOpenAIApiKey(): string {
  return process.env.OPENAI_API_KEY || "";
}

export function getContactBoxBaseUrl(): string {
  const raw =
    process.env.CONTACTBOX_BASE_URL || "https://api.contactboxtools.me/v1";
  return raw.replace(/\/$/, "");
}

export function getOpenAIBaseUrl(): string {
  const raw = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  return raw.replace(/\/$/, "");
}

export function getReasoningModel(): string {
  // ContactBox recommended Codex/reasoning model
  return process.env.CONTACTBOX_REASONING_MODEL || "gpt-5.6-terra";
}

export function getImageModel(): string {
  return process.env.CONTACTBOX_IMAGE_MODEL || "gpt-image-2";
}

export function getOpenAIReasoningModel(): string {
  return process.env.OPENAI_REASONING_MODEL || "gpt-4o";
}

export function getOpenAIImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL || "dall-e-3";
}

export function getReasoningModelFallbacks(): string[] {
  const primary = getReasoningModel();
  const extra = (process.env.CONTACTBOX_REASONING_MODEL_FALLBACKS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [
    ...new Set([
      primary,
      ...extra,
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
    ]),
  ];
}

export function getImageModelFallbacks(): string[] {
  const primary = getImageModel();
  const extra = (process.env.CONTACTBOX_IMAGE_MODEL_FALLBACKS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [
    ...new Set([primary, ...extra, "gpt-image-2", "gpt-image-1", "dall-e-3"]),
  ];
}

export function getImageQuality(): "low" | "medium" | "high" | "auto" {
  const q = (process.env.CONTACTBOX_IMAGE_QUALITY || "high").toLowerCase();
  if (q === "low" || q === "medium" || q === "high" || q === "auto") return q;
  return "high";
}

/** 16:9 YouTube-friendly default */
export function getImageSize(): string {
  return process.env.CONTACTBOX_IMAGE_SIZE || "1280x720";
}

export function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID || "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || "";
  const bucket = process.env.R2_BUCKET || "auto-thumb";
  const endpoint =
    process.env.R2_ENDPOINT ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  const publicBaseUrl = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    publicBaseUrl,
    configured: Boolean(accessKeyId && secretAccessKey && bucket && endpoint),
  };
}
