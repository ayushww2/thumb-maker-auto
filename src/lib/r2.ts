import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getR2Config } from "@/lib/env";
import { randomUUID } from "crypto";

function getClient() {
  const cfg = getR2Config();
  if (!cfg.configured) {
    throw new Error(
      "R2 is not configured (need R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT)",
    );
  }
  return {
    cfg,
    client: new S3Client({
      region: "auto",
      endpoint: cfg.endpoint,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    }),
  };
}

export async function uploadThumbnail(bytes: Buffer, contentType = "image/png") {
  const { cfg, client } = getClient();
  const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
  const key = `thumbs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;

  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );

  const publicUrl = cfg.publicBaseUrl ? `${cfg.publicBaseUrl}/${key}` : null;
  return { key, bucket: cfg.bucket, publicUrl };
}
