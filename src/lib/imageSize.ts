import sharp from "sharp";

/** YouTube thumbnail native aspect — always enforce this on output. */
export const YT_THUMB_WIDTH = 1280;
export const YT_THUMB_HEIGHT = 720;

/**
 * Center-cover crop/resize any buffer into exact 1280x720 (16:9).
 * Preserves left/right news-split layout better than letterboxing.
 */
export async function toYouTube16x9(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .resize(YT_THUMB_WIDTH, YT_THUMB_HEIGHT, {
      fit: "cover",
      position: "centre",
    })
    .png()
    .toBuffer();
}
