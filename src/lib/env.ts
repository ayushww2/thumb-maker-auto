export function getContactBoxApiKey(): string {
  return process.env.CONTACTBOX_API_KEY || process.env.OPENAI_API_KEY || "";
}

export function getContactBoxBaseUrl(): string {
  const raw =
    process.env.CONTACTBOX_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    "https://api.contactboxtools.me/v1";
  return raw.replace(/\/$/, "");
}

export function getReasoningModel(): string {
  // ContactBox currently exposes gpt-5.5. gpt-5.6-terra has no available
  // channel in its default distributor group.
  return process.env.CONTACTBOX_REASONING_MODEL || "gpt-5.5";
}

export function getImageModel(): string {
  return process.env.CONTACTBOX_IMAGE_MODEL || "gpt-image-2";
}

export function getImageQuality(): "low" | "medium" | "high" | "auto" {
  const q = (process.env.CONTACTBOX_IMAGE_QUALITY || "high").toLowerCase();
  if (q === "low" || q === "medium" || q === "high" || q === "auto") return q;
  return "high";
}

/** 16:9 YouTube-friendly default */
export function getImageSize(): string {
  // Prefer YouTube-native 16:9. Note: 1536x1024 is 3:2, not 16:9.
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
